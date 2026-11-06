import os
import re
import json
import asyncio
import logging
import random
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Any, Optional, Literal

import asyncpg
import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import ai  # noqa: E402
import db  # noqa: E402
from db import W  # noqa: E402

JWT_SECRET = os.environ["JWT_SECRET"]

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("rcortexa")

app = FastAPI(title="RCortexa API", version="2.0.0", docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api = APIRouter(prefix="/api")


@api.get("/health")
async def api_health():
    """Readiness probe: verifies the Supabase connection and reports whether AI is configured."""
    try:
        db_ok = await db.fetchval("select 1") == 1
    except Exception as e:
        logger.error("DB health check failed: %s", e)
        db_ok = False
    return JSONResponse({"status": "ok" if db_ok else "degraded", "db": db_ok, "ai_enabled": ai.enabled()}, status_code=200 if db_ok else 503)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
STAGES = ["new", "contacted", "site_visit_scheduled", "negotiation", "closed_won", "closed_lost"]
STAGE_PROB = {"new": 0.05, "contacted": 0.15, "site_visit_scheduled": 0.35, "negotiation": 0.6, "closed_won": 1.0, "closed_lost": 0.0}
ADMINS = ("org_admin", "finance")
ORG_ROLES = ("org_admin", "finance", "sales_exec", "channel_partner")
INTERNAL = ("org_admin", "finance", "sales_exec")
OPEN = ("closed_won", "closed_lost")


def now() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise HTTPException(400, "Invalid date")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def out(row: Optional[dict], exclude: set = frozenset()) -> Optional[dict]:
    if not row:
        return None
    return {k: v for k, v in row.items() if k != "password_hash" and k not in exclude}


def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def make_token(user: dict) -> str:
    return jwt.encode({"sub": user["id"], "iat": now(), "exp": now() + timedelta(days=7)}, JWT_SECRET, algorithm="HS256")


bearer = HTTPBearer(auto_error=False)


async def current_user(cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    if not cred:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid or expired session")
    user = await db.fetchrow("select u.*, o.status as org_status from users u left join orgs o on o.id = u.org_id where u.id = $1", payload.get("sub"))
    if not user or not user["is_active"]:
        raise HTTPException(401, "Account inactive")
    if user["org_id"] and user["org_status"] == "suspended":
        raise HTTPException(403, "Organization suspended. Contact RCortexa support.")
    user.pop("org_status", None)
    if not user["last_seen"] or user["last_seen"] < now() - timedelta(seconds=60):
        await db.execute("update users set last_seen = now() where id = $1", user["id"])
    return user


def require(*roles: str):
    async def dep(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "You don't have permission for this action")
        return user
    return dep


async def audit(user: dict, action: str, entity: str, entity_id: str = "", detail: str = "", conn=None):
    await db.insert("audit_logs", {"org_id": user.get("org_id"), "user_id": user["id"], "user_name": user.get("name"), "role": user.get("role"),
                                   "action": action, "entity": entity, "entity_id": entity_id or "", "detail": detail or ""}, conn=conn)


async def notify(org_id: str, user_id: str, title: str, body: str, kind: str = "info", link: str = "", conn=None):
    await db.insert("notifications", {"org_id": org_id, "user_id": user_id, "title": title, "body": body, "kind": kind, "link": link}, conn=conn)


async def add_activity(org_id: str, lead_id: str, kind: str, text: str, user: Optional[dict] = None, meta: Optional[dict] = None, conn=None):
    await db.insert("activities", {"org_id": org_id, "lead_id": lead_id, "type": kind, "text": text,
                                   "user_id": user["id"] if user else None, "user_name": user["name"] if user else "RCortexa Automation",
                                   "meta": meta or {}}, conn=conn)
    await db.execute("update leads set last_activity_at = now() where id = $1", lead_id, conn=conn)


BOOKED_SCORE = {"score": 100, "tier": "Hot", "score_factors": ["Unit booked — deal closed won"],
                "next_action": "Collect booking documents and payment schedule", "score_source": "rules"}
SCORE_FIELDS = {"stage", "budget_min", "budget_max", "bhk", "preferred_facing", "timeline"}


def rule_score(lead: dict, activity_count: int = 0) -> dict:
    if lead.get("stage") == "closed_won":
        return dict(BOOKED_SCORE)
    score, factors = 25, []
    src = lead.get("source", "")
    if src in ("channel_partner", "referral"):
        score += 15; factors.append("High-intent source (partner/referral) +15")
    elif src in ("whatsapp", "website"):
        score += 10; factors.append("Direct inbound inquiry +10")
    elif src:
        score += 5; factors.append(f"Portal/ad source ({src}) +5")
    if lead.get("budget_max"):
        score += 10; factors.append("Budget shared +10")
    if lead.get("bhk"):
        score += 5; factors.append("Configuration specified +5")
    if lead.get("timeline") in ("immediate", "0-3 months"):
        score += 15; factors.append("Buying within 3 months +15")
    stage_bonus = {"contacted": 8, "site_visit_scheduled": 18, "negotiation": 28, "closed_won": 35}.get(lead.get("stage"), 0)
    if stage_bonus:
        score += stage_bonus; factors.append(f"Pipeline progress ({lead['stage'].replace('_', ' ')}) +{stage_bonus}")
    if lead.get("qualified"):
        score += 10; factors.append("Qualified by AI voice agent +10")
    eng = min(activity_count * 2, 10)
    if eng:
        score += eng; factors.append(f"Engagement ({activity_count} interactions) +{eng}")
    if lead.get("stage") == "closed_lost":
        score = min(score, 20); factors.append("Marked lost — capped")
    score = max(0, min(100, score))
    tier = "Hot" if score >= 70 else "Warm" if score >= 45 else "Cold"
    nxt = {"Hot": "Call today and lock a site visit", "Warm": "Share matching units on WhatsApp", "Cold": "Add to nurture re-engagement"}[tier]
    return {"score": score, "tier": tier, "score_factors": factors, "next_action": nxt, "score_source": "rules"}


def extract_json(text: str) -> Optional[dict]:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def lead_scope(user: dict, alias: str = "") -> W:
    p = f"{alias}." if alias else ""
    w = W().add(f"{p}org_id = ?", user["org_id"])
    if user["role"] == "sales_exec":
        w.add(f"{p}assigned_to = ?", user["id"])
    elif user["role"] == "channel_partner":
        w.add(f"{p}cp_user_id = ?", user["id"])
    return w


async def get_lead_scoped(user: dict, lead_id: str, conn=None) -> dict:
    w = lead_scope(user).add("id = ?", lead_id)
    lead = await db.fetchrow(f"select * from leads where {w.sql}", *w.args, conn=conn)
    if not lead:
        raise HTTPException(404, "Lead not found")
    return lead


UNIT_PRIVATE = ("buyer_name", "buyer_phone", "sold_by", "sold_by_name", "reserved_by_name", "lead_id")


def mask_unit(unit: dict, user: dict) -> dict:
    d = out(unit)
    if user["role"] not in ADMINS:
        for k in UNIT_PRIVATE:
            d.pop(k, None)
    return d


async def release_expired(org_id: str, conn=None):
    await db.execute(
        "update units set status = 'available', reserved_until = null, lead_id = null, reserved_by = null, reserved_by_name = null, "
        "buyer_name = null, buyer_phone = null where org_id = $1 and status = 'reserved' and reserved_until < now()", org_id, conn=conn)


async def smart_assign(org_id: str, conn=None) -> Optional[dict]:
    return await db.fetchrow(
        "select u.* from users u left join leads l on l.assigned_to = u.id and l.stage not in ('closed_won','closed_lost') "
        "where u.org_id = $1 and u.role = 'sales_exec' and u.is_active group by u.id order by count(l.id), u.created_at limit 1", org_id, conn=conn)


async def activity_count(lead_id: str) -> int:
    return await db.fetchval("select count(*) from activities where lead_id = $1", lead_id)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class LoginIn(BaseModel):
    email: str
    password: str


class PartnerSignupIn(BaseModel):
    org_code: str
    name: str
    email: str
    password: str
    phone: str = ""
    agency: str
    rera_id: str = ""


async def get_org(org_id: Optional[str]) -> Optional[dict]:
    return await db.fetchrow("select * from orgs where id = $1", org_id) if org_id else None


# Subscription/billing fields are visible to the Organization Admin only (and global admins via /admin).
BILLING_FIELDS = {"plan", "seats", "renewal_date"}


def org_view(org: Optional[dict], role: Optional[str]) -> Optional[dict]:
    if not org:
        return None
    return out(org) if role in ("org_admin", "global_admin") else {k: v for k, v in out(org).items() if k not in BILLING_FIELDS}


def auth_payload(user: dict, org: Optional[dict]) -> dict:
    return {"token": make_token(user), "user": out(user), "org": org_view(org, user["role"])}


@api.post("/auth/login")
async def login(body: LoginIn):
    user = await db.fetchrow("select * from users where email = $1", body.email.strip().lower())
    if not user or not verify_pw(body.password, user["password_hash"]):
        raise HTTPException(401, "Incorrect email or password")
    if not user["is_active"]:
        raise HTTPException(403, "Account deactivated")
    org = await get_org(user["org_id"])
    if org and org["status"] == "suspended":
        raise HTTPException(403, "Organization suspended. Contact RCortexa support.")
    await audit(user, "login", "session")
    return auth_payload(user, org)


@api.post("/auth/partner-signup")
async def partner_signup(body: PartnerSignupIn):
    org = await db.fetchrow("select * from orgs where code = $1 and status = 'active'", body.org_code.strip().upper())
    if not org:
        raise HTTPException(404, "Invalid organization code")
    email = body.email.strip().lower()
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    try:
        async with db.tx() as c:
            user = await db.insert("users", {"email": email, "name": body.name.strip(), "role": "channel_partner", "org_id": org["id"],
                                             "password_hash": hash_pw(body.password), "phone": body.phone}, conn=c)
            await db.insert("partners", {"org_id": org["id"], "user_id": user["id"], "name": user["name"], "email": email, "phone": body.phone,
                                         "agency": body.agency, "rera_id": body.rera_id, "status": "pending", "commission_type": "percent",
                                         "commission_value": 1.5}, conn=c)
            admin = await db.fetchrow("select id from users where org_id = $1 and role = 'org_admin' order by created_at limit 1", org["id"], conn=c)
            if admin:
                await notify(org["id"], admin["id"], "New channel partner", f"{body.agency} requested portal access", "partner", "/partners", conn=c)
            await audit(user, "signup", "partner", user["id"], conn=c)
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "Email already registered")
    return auth_payload(user, org)


@api.get("/auth/me")
async def me(user=Depends(current_user)):
    return {"user": out(user), "org": org_view(await get_org(user["org_id"]), user["role"])}


# ---------------------------------------------------------------------------
# Leads
# ---------------------------------------------------------------------------
class LeadIn(BaseModel):
    name: str
    phone: str
    email: str = ""
    source: str = "manual"
    project_id: Optional[str] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    bhk: Optional[int] = None
    preferred_facing: Optional[str] = None
    location: str = ""
    timeline: str = ""
    notes: str = ""


class LeadPatch(BaseModel):
    stage: Optional[str] = None
    assigned_to: Optional[str] = None
    lost_reason: Optional[str] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    bhk: Optional[int] = None
    preferred_facing: Optional[str] = None
    timeline: Optional[str] = None


class ActivityIn(BaseModel):
    type: Literal["note", "call", "whatsapp", "email"] = "note"
    text: str
    disposition: str = ""


class EngageIn(BaseModel):
    choice: Literal["now", "schedule"]
    callback_at: Optional[str] = None


def norm_phone(p: str) -> str:
    return re.sub(r"\D", "", p)[-10:]


@api.get("/leads")
async def list_leads(stage: Optional[str] = None, q: Optional[str] = None, tier: Optional[str] = None, user=Depends(require(*ORG_ROLES))):
    base = lead_scope(user)
    w = lead_scope(user)
    if stage and stage != "all":
        w.add("stage = ?", stage)
    if tier:
        w.add("tier = ?", tier)
    if q:
        pattern = f"%{q.replace('%', '').replace('_', '')}%"
        w.add("(name ilike ? or phone like ?)", pattern, pattern)
    count_rows, items = await asyncio.gather(
        db.fetch(f"select stage, count(*) n from leads where {base.sql} group by stage", *base.args),
        db.fetch(f"select * from leads where {w.sql} order by created_at desc limit 500", *w.args))
    counts = {s: 0 for s in STAGES}
    for r in count_rows:
        counts[r["stage"]] = r["n"]
    return {"items": items, "counts": counts}


@api.post("/leads")
async def create_lead(body: LeadIn, user=Depends(require("org_admin", "sales_exec", "channel_partner"))):
    org_id = user["org_id"]
    phone = norm_phone(body.phone)
    if len(phone) != 10:
        raise HTTPException(400, "Enter a valid 10-digit mobile number")
    partner = None
    if user["role"] == "channel_partner":
        partner = await db.fetchrow("select * from partners where org_id = $1 and user_id = $2", org_id, user["id"])
        if not partner or partner["status"] != "approved":
            raise HTTPException(403, "Your partner account is pending approval")

    async def duplicate(existing: dict):
        owner = existing.get("cp_name") or existing.get("assigned_name") or "another team member"
        await audit(user, "duplicate_blocked", "lead", existing["id"], phone)
        raise HTTPException(409, "This buyer is already registered and locked" if partner else f"Duplicate lead — already owned by {owner}")

    existing = await db.fetchrow("select id, cp_name, assigned_name from leads where org_id = $1 and phone = $2", org_id, phone)
    if existing:
        await duplicate(existing)
    project_name = None
    if body.project_id:
        project_name = await db.fetchval("select name from projects where id = $1 and org_id = $2", body.project_id, org_id)
        if not project_name:
            body.project_id = None
    lead = body.model_dump() | {"org_id": org_id, "phone": phone, "project_name": project_name, "stage": "new", "created_by": user["id"],
                                "qualified": False, "engagement": {"whatsapp": "sent", "choice": None}, "locked": False}
    if partner:
        lead.update({"source": "channel_partner", "cp_user_id": user["id"], "cp_name": partner["agency"], "locked": True,
                     "lock_expires_at": now() + timedelta(days=90)})
    try:
        async with db.tx() as c:
            assignee = user if user["role"] == "sales_exec" else await smart_assign(org_id, conn=c)
            if assignee:
                lead["assigned_to"] = assignee["id"]; lead["assigned_name"] = assignee["name"]
            lead.update(rule_score(lead))
            row = await db.insert("leads", lead, conn=c)
            lid = row["id"]
            await add_activity(org_id, lid, "created", f"Lead captured via {lead['source'].replace('_', ' ')}", user, conn=c)
            if partner:
                await add_activity(org_id, lid, "lock", f"Ownership locked to {partner['agency']} for 90 days", None, conn=c)
            if assignee:
                how = "self-assigned" if assignee is user else "smart assignment · lowest active workload"
                await add_activity(org_id, lid, "assignment", f"Assigned to {assignee['name']} ({how})", None, conn=c)
                if assignee is not user:
                    await notify(org_id, assignee["id"], "New lead assigned", f"{body.name} · {lead['tier']} lead", "lead", f"/lead/{lid}", conn=c)
            await add_activity(org_id, lid, "whatsapp", "[DEMO] Instant WhatsApp sent: \"Thanks for your interest! When would you like us to contact you? [Now] [Choose a time]\"", None, conn=c)
            await audit(user, "create", "lead", lid, body.name, conn=c)
    except asyncpg.UniqueViolationError:  # concurrent duplicate registration
        await duplicate(await db.fetchrow("select id, cp_name, assigned_name from leads where org_id = $1 and phone = $2", org_id, phone))
    return out(await db.fetchrow("select * from leads where id = $1", lid))


@api.get("/leads/{lead_id}")
async def get_lead(lead_id: str, user=Depends(require(*ORG_ROLES))):
    lead = await get_lead_scoped(user, lead_id)
    acts = await db.fetch("select * from activities where org_id = $1 and lead_id = $2 order by created_at desc limit 200", user["org_id"], lead_id)
    visits = await db.fetch("select * from site_visits where org_id = $1 and lead_id = $2 order by scheduled_at desc limit 50", user["org_id"], lead_id)
    units = await db.fetch("select * from units where org_id = $1 and lead_id = $2", user["org_id"], lead_id)
    return {"lead": out(lead), "activities": acts, "visits": visits, "units": [mask_unit(u, user) | {"lead_id": lead_id} for u in units]}


@api.patch("/leads/{lead_id}")
async def update_lead(lead_id: str, body: LeadPatch, user=Depends(require("org_admin", "sales_exec"))):
    lead = await get_lead_scoped(user, lead_id)
    upd = body.model_dump(exclude_none=True)
    if "stage" in upd and upd["stage"] not in STAGES:
        raise HTTPException(400, "Invalid stage")
    if "assigned_to" in upd:
        if user["role"] != "org_admin":
            raise HTTPException(403, "Only admins can reassign leads")
        ex = await db.fetchrow("select * from users where id = $1 and org_id = $2 and role = 'sales_exec'", upd["assigned_to"], user["org_id"])
        if not ex:
            raise HTTPException(400, "Invalid sales executive")
        upd["assigned_name"] = ex["name"]
        await add_activity(user["org_id"], lead_id, "assignment", f"Reassigned to {ex['name']}", user)
        await notify(user["org_id"], ex["id"], "Lead reassigned to you", lead["name"], "lead", f"/lead/{lead_id}")
    if "stage" in upd and upd["stage"] != lead["stage"]:
        await add_activity(user["org_id"], lead_id, "stage", f"Stage: {lead['stage'].replace('_', ' ')} → {upd['stage'].replace('_', ' ')}", user)
    changed = {k for k in SCORE_FIELDS if k in upd and upd[k] != lead.get(k)}
    if changed and (lead["stage"] != "closed_won" or "stage" in changed) and (lead.get("score_source") != "ai" or "stage" in changed):
        upd.update(rule_score({**lead, **upd}, await activity_count(lead_id)), scored_at=now())
    upd["updated_at"] = now()
    row = await db.update("leads", W().add("id = ?", lead_id), upd)
    await audit(user, "update", "lead", lead_id, ", ".join(body.model_dump(exclude_none=True).keys()))
    return out(row)


@api.post("/leads/{lead_id}/activities")
async def log_activity(lead_id: str, body: ActivityIn, user=Depends(require("org_admin", "sales_exec"))):
    lead = await get_lead_scoped(user, lead_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Activity text required")
    if body.disposition:
        text = f"{text} · {body.disposition}"
    await add_activity(user["org_id"], lead_id, body.type, text, user, {"disposition": body.disposition})
    if lead["stage"] == "new" and body.type == "call":
        await db.execute("update leads set stage = 'contacted', updated_at = now() where id = $1", lead_id)
        await add_activity(user["org_id"], lead_id, "stage", "Stage: new → contacted", None)
    return {"ok": True}


@api.post("/leads/{lead_id}/engage")
async def engage(lead_id: str, body: EngageIn, user=Depends(require("org_admin", "sales_exec"))):
    """Demo mode: simulates the buyer tapping [Now] / [Choose a time] on the WhatsApp trigger."""
    lead = await get_lead_scoped(user, lead_id)
    org_id = user["org_id"]
    if body.choice == "schedule":
        if not body.callback_at:
            raise HTTPException(400, "Pick a callback time")
        at = parse_ts(body.callback_at)
        if at < now():
            raise HTTPException(400, "Callback time must be in the future")
        await db.execute("update leads set callback_at = $2, engagement = engagement || jsonb_build_object('choice', 'schedule'::text) where id = $1", lead_id, at)
        await add_activity(org_id, lead_id, "callback", f"[DEMO] Buyer chose a callback slot — AI voice call scheduled for {at.strftime('%d %b, %I:%M %p')} UTC", None)
        if lead.get("assigned_to"):
            await notify(org_id, lead["assigned_to"], "Callback scheduled", f"{lead['name']} · {at.strftime('%d %b %I:%M %p')} UTC", "callback", f"/lead/{lead_id}")
        return {"ok": True, "mode": "demo"}
    city = await db.fetchval("select city from projects where org_id = $1 and status = 'active' order by created_at limit 1", org_id)
    q = {
        "budget_min": lead.get("budget_min") or random.choice([6000000, 8000000, 10000000]),
        "budget_max": lead.get("budget_max") or random.choice([9000000, 12000000, 15000000]),
        "bhk": lead.get("bhk") or random.choice([2, 3]),
        "preferred_facing": lead.get("preferred_facing") or random.choice(["North", "East"]),
        "timeline": lead.get("timeline") or "0-3 months",
        "location": lead.get("location") or city or "",
    }
    summary = (f"[DEMO] AI voice agent called {lead['name']} (2m 41s). Buyer wants a {q['bhk']} BHK, {q['preferred_facing']}-facing, "
               f"budget ₹{q['budget_min'] / 1e5:.0f}L–₹{q['budget_max'] / 1e5:.0f}L, purchase timeline {q['timeline']}. Requested a site visit this weekend.")
    n = await activity_count(lead_id)
    upd = {**q, "qualified": True, "updated_at": now(), **rule_score({**lead, **q, "qualified": True}, n + 1),
           "engagement": {**(lead.get("engagement") or {}), "choice": "now"}}
    if lead["stage"] == "new":
        upd["stage"] = "contacted"
    await db.update("leads", W().add("id = ?", lead_id), upd)
    await add_activity(org_id, lead_id, "voice_call", summary, None, {"duration": 161})
    if lead.get("assigned_to"):
        await notify(org_id, lead["assigned_to"], "Qualified lead ready", f"{lead['name']} qualified by AI voice agent", "lead", f"/lead/{lead_id}")
    return {"ok": True, "mode": "demo"}


@api.post("/leads/{lead_id}/score")
async def ai_score(lead_id: str, user=Depends(require(*INTERNAL))):
    lead = await get_lead_scoped(user, lead_id)
    acts = await db.fetch("select type, text from activities where lead_id = $1 order by created_at desc limit 15", lead_id)
    facts = {k: lead.get(k) for k in ("name", "source", "stage", "budget_min", "budget_max", "bhk", "preferred_facing", "location", "timeline", "qualified", "project_name", "created_at", "last_activity_at")}
    prompt = (f"Score this Indian real-estate buyer lead.\nLEAD: {json.dumps(facts, default=str)}\n"
              f"RECENT ACTIVITY: {json.dumps([a['type'] + ': ' + a['text'] for a in acts])}\n"
              "Return ONLY JSON: {\"score\": int 0-100, \"tier\": \"Hot\"|\"Warm\"|\"Cold\", \"factors\": [3-5 short strings with +/- impact], "
              "\"confidence\": float 0-1, \"next_action\": short string}")
    result = None
    try:
        if ai.enabled():
            result = extract_json(await ai.complete("You are RCortexa's lead-scoring engine. Be precise, explainable and concise.", prompt))
    except Exception as e:  # provider failure → explainable rule fallback
        logger.warning("AI score failed: %s", e)
    if result and isinstance(result.get("score"), (int, float)):
        s = int(max(0, min(100, result["score"])))
        upd = {"score": s, "tier": result.get("tier") if result.get("tier") in ("Hot", "Warm", "Cold") else ("Hot" if s >= 70 else "Warm" if s >= 45 else "Cold"),
               "score_factors": [str(f) for f in result.get("factors", [])][:5], "next_action": str(result.get("next_action", "")),
               "score_confidence": float(result.get("confidence", 0.7)), "score_source": "ai"}
    else:
        upd = rule_score(lead, len(acts))
    upd["scored_at"] = now()
    row = await db.update("leads", W().add("id = ?", lead_id), upd)
    await add_activity(user["org_id"], lead_id, "ai", f"AI score updated: {upd['score']} ({upd['tier']})", None)
    return out(row)


@api.get("/leads/{lead_id}/recommendations")
async def recommendations(lead_id: str, user=Depends(require(*INTERNAL))):
    lead = await get_lead_scoped(user, lead_id)
    await release_expired(user["org_id"])
    units = await db.fetch("select u.*, p.name as project_name, p.city as p_city, p.location as p_location from units u join projects p on p.id = u.project_id "
                           "where u.org_id = $1 and u.status = 'available'", user["org_id"])
    ranked = []
    for u in units:
        score, why = 0, []
        price = u["base_price"]
        bmin, bmax = lead.get("budget_min") or 0, lead.get("budget_max")
        if bmax:
            if bmin <= price <= bmax:
                score += 40; why.append("Within budget")
            elif price <= bmax * 1.1:
                score += 20; why.append("Within 10% of budget")
            else:
                continue
        else:
            score += 15
        if lead.get("bhk"):
            if u["bhk"] == lead["bhk"]:
                score += 25; why.append(f"{u['bhk']} BHK match")
            else:
                score -= 10
        if lead.get("preferred_facing") and u["facing"] == lead["preferred_facing"]:
            score += 15; why.append(f"{u['facing']}-facing")
        if lead.get("project_id") and u["project_id"] == lead["project_id"]:
            score += 15; why.append("Preferred project")
        if lead.get("location") and lead["location"].lower() in f"{u['p_city']} {u['p_location']}".lower():
            score += 5; why.append("Preferred location")
        ranked.append((score, u, why))
    ranked.sort(key=lambda x: -x[0])
    res = []
    for s, u, why in ranked[:5]:
        pn = u.pop("project_name"); u.pop("p_city"); u.pop("p_location")
        res.append(mask_unit(u, user) | {"match": max(0, min(100, s)), "reasons": why, "project_name": pn})
    return res


# ---------------------------------------------------------------------------
# Projects & inventory
# ---------------------------------------------------------------------------
class UnitAction(BaseModel):
    lead_id: Optional[str] = None


@api.get("/units/{unit_id}")
async def get_unit(unit_id: str, user=Depends(require(*ORG_ROLES))):
    await release_expired(user["org_id"])
    u = await db.fetchrow("select u.*, p.name as project_name from units u join projects p on p.id = u.project_id where u.id = $1 and u.org_id = $2", unit_id, user["org_id"])
    if not u:
        raise HTTPException(404, "Unit not found")
    from routes_inventory import file_url
    return mask_unit(u, user) | {"can_view_buyer": user["role"] in ADMINS, "floor_plan_url": file_url(u.get("floor_plan_asset_id"), u["org_id"])}


@api.post("/units/{unit_id}/reserve")
async def reserve_unit(unit_id: str, body: UnitAction, user=Depends(require("org_admin", "sales_exec"))):
    if not body.lead_id:
        raise HTTPException(400, "Select a lead to reserve for")
    lead = await get_lead_scoped(user, body.lead_id)
    await release_expired(user["org_id"])
    # Atomic: only one concurrent request can flip status from 'available'.
    u = await db.fetchrow(
        "update units set status = 'reserved', reserved_until = now() + interval '48 hours', lead_id = $3, reserved_by = $4, reserved_by_name = $5, "
        "buyer_name = $6, buyer_phone = $7, updated_at = now(), version = version + 1 "
        "where id = $1 and org_id = $2 and status = 'available' returning *",
        unit_id, user["org_id"], lead["id"], user["id"], user["name"], lead["name"], lead["phone"])
    if not u:
        if not await db.fetchval("select 1 from units where id = $1 and org_id = $2", unit_id, user["org_id"]):
            raise HTTPException(404, "Unit not found")
        raise HTTPException(409, "Unit is no longer available — someone else just reserved or sold it")
    await add_activity(user["org_id"], lead["id"], "inventory", f"Reserved {u['tower']}-{u['unit_no']} for 48 hours", user)
    await audit(user, "reserve", "unit", unit_id, f"{u['tower']}-{u['unit_no']}")
    return mask_unit(u, user)


@api.post("/units/{unit_id}/book")
async def book_unit(unit_id: str, body: UnitAction, user=Depends(require("org_admin", "sales_exec"))):
    cur = await db.fetchrow("select * from units where id = $1 and org_id = $2", unit_id, user["org_id"])
    if not cur:
        raise HTTPException(404, "Unit not found")
    lead_id = body.lead_id or cur["lead_id"]
    if not lead_id:
        raise HTTPException(400, "Select a lead to book for")
    lead = await get_lead_scoped(user, lead_id)
    async with db.tx() as c:
        u = await db.fetchrow(
            "update units set status = 'sold', lead_id = $3, buyer_name = $4, buyer_phone = $5, sold_by = $6, sold_by_name = $7, sold_at = now(), "
            "reserved_until = null, agreement_value = base_price, updated_at = now(), version = version + 1 "
            "where id = $1 and org_id = $2 and (status = 'available' or (status = 'reserved' and lead_id = $3)) returning *",
            unit_id, user["org_id"], lead_id, lead["name"], lead["phone"], user["id"], user["name"], conn=c)
        if not u:
            raise HTTPException(409, "Booking conflict — unit is reserved for another buyer or already sold")
        await db.execute("update leads set stage = 'closed_won', score = 100, tier = 'Hot', score_source = 'rules', scored_at = now(), "
                         "score_factors = '[\"Unit booked — deal closed won\"]'::jsonb, next_action = 'Collect booking documents and payment schedule', "
                         "updated_at = now() where id = $1", lead_id, conn=c)
        await add_activity(user["org_id"], lead_id, "booking", f"Booked {u['tower']}-{u['unit_no']} · ₹{u['base_price'] / 1e5:.1f}L", user, conn=c)
        if lead.get("cp_user_id"):
            partner = await db.fetchrow("select * from partners where org_id = $1 and user_id = $2", user["org_id"], lead["cp_user_id"], conn=c)
            if partner:
                amt = partner["commission_value"] * u["base_price"] / 100 if partner["commission_type"] == "percent" else partner["commission_value"]
                await db.insert("commissions", {"org_id": user["org_id"], "partner_id": partner["id"], "partner_user_id": lead["cp_user_id"],
                                                "agency": partner["agency"], "lead_id": lead_id, "lead_name": lead["name"], "unit_id": unit_id,
                                                "unit_label": f"{u['tower']}-{u['unit_no']}", "agreement_value": u["base_price"], "amount": round(amt),
                                                "milestone": "On booking", "status": "pending"}, conn=c)
                await notify(user["org_id"], lead["cp_user_id"], "Commission generated", f"Booking confirmed for {lead['name']}", "commission", "/", conn=c)
        for a in await db.fetch("select id from users where org_id = $1 and role in ('org_admin','finance')", user["org_id"], conn=c):
            await notify(user["org_id"], a["id"], "Unit sold", f"{u['tower']}-{u['unit_no']} booked by {user['name']}", "booking", f"/unit/{unit_id}", conn=c)
        await audit(user, "book", "unit", unit_id, f"{u['tower']}-{u['unit_no']} for {lead['name']}", conn=c)
    return mask_unit(u, user)


@api.post("/units/{unit_id}/release")
async def release_unit(unit_id: str, user=Depends(require("org_admin", "sales_exec"))):
    w = W().add("id = ?", unit_id).add("org_id = ?", user["org_id"]).add("status = 'reserved'")
    if user["role"] == "sales_exec":
        w.add("reserved_by = ?", user["id"])
    u = await db.update("units", w, {"status": "available", "reserved_until": None, "lead_id": None, "reserved_by": None,
                                     "reserved_by_name": None, "buyer_name": None, "buyer_phone": None, "updated_at": now()})
    if not u:
        raise HTTPException(409, "Only the reserving executive or an admin can release this unit")
    await audit(user, "release", "unit", unit_id)
    return mask_unit(u, user)


@api.post("/units/{unit_id}/block")
async def block_unit(unit_id: str, user=Depends(require("org_admin"))):
    u = await db.fetchrow("update units set status = case when status = 'blocked' then 'available' else 'blocked' end, updated_at = now() "
                          "where id = $1 and org_id = $2 and status in ('available','blocked') returning *", unit_id, user["org_id"])
    if not u:
        raise HTTPException(409, "Only available units can be blocked")
    await audit(user, u["status"], "unit", unit_id)
    return mask_unit(u, user)


# ---------------------------------------------------------------------------
# Site visits
# ---------------------------------------------------------------------------
class VisitIn(BaseModel):
    lead_id: str
    project_id: str
    scheduled_at: str


class VisitPatch(BaseModel):
    status: Literal["scheduled", "completed", "cancelled", "no_show"]
    scheduled_at: Optional[str] = None


@api.get("/site-visits")
async def list_visits(user=Depends(require(*INTERNAL))):
    w = W().add("org_id = ?", user["org_id"])
    if user["role"] == "sales_exec":
        w.add("assigned_to = ?", user["id"])
    return await db.fetch(f"select * from site_visits where {w.sql} order by scheduled_at limit 300", *w.args)


@api.post("/site-visits")
async def create_visit(body: VisitIn, user=Depends(require("org_admin", "sales_exec"))):
    lead = await get_lead_scoped(user, body.lead_id)
    p = await db.fetchrow("select * from projects where id = $1 and org_id = $2", body.project_id, user["org_id"])
    if not p:
        raise HTTPException(404, "Project not found")
    at = parse_ts(body.scheduled_at)
    if at < now() - timedelta(minutes=5):
        raise HTTPException(400, "Visit time must be in the future")
    maps = f"https://maps.google.com/?q={p['lat']},{p['lng']}"
    async with db.tx() as c:
        visit = await db.insert("site_visits", {"org_id": user["org_id"], "lead_id": lead["id"], "lead_name": lead["name"], "lead_phone": lead["phone"],
                                                "project_id": p["id"], "project_name": p["name"], "location": p["location"], "maps_url": maps,
                                                "scheduled_at": at, "status": "scheduled", "assigned_to": lead.get("assigned_to"),
                                                "assigned_name": lead.get("assigned_name"), "created_by": user["id"]}, conn=c)
        if STAGES.index(lead["stage"]) < 2:
            sc = rule_score({**lead, "stage": "site_visit_scheduled"})
            await db.update("leads", W().add("id = ?", lead["id"]), {"stage": "site_visit_scheduled", **sc, "updated_at": now()}, conn=c)
        await add_activity(user["org_id"], lead["id"], "site_visit", f"Site visit scheduled at {p['name']} · {at.strftime('%d %b, %I:%M %p')} UTC", user, conn=c)
        await add_activity(user["org_id"], lead["id"], "whatsapp", f"[DEMO] WhatsApp confirmation sent with location pin: {maps}", None, conn=c)
        if lead.get("assigned_to"):
            await notify(user["org_id"], lead["assigned_to"], "Site visit scheduled", f"{lead['name']} · {p['name']}", "visit", "/visits", conn=c)
    return visit


@api.patch("/site-visits/{visit_id}")
async def update_visit(visit_id: str, body: VisitPatch, user=Depends(require("org_admin", "sales_exec"))):
    w = W().add("id = ?", visit_id).add("org_id = ?", user["org_id"])
    if user["role"] == "sales_exec":
        w.add("assigned_to = ?", user["id"])
    upd: dict[str, Any] = {"status": body.status}
    if body.scheduled_at:
        upd["scheduled_at"] = parse_ts(body.scheduled_at)
    v = await db.update("site_visits", w, upd)
    if not v:
        raise HTTPException(404, "Visit not found")
    await add_activity(user["org_id"], v["lead_id"], "site_visit", f"Site visit marked {body.status.replace('_', ' ')}", user)
    return v


# ---------------------------------------------------------------------------
# Channel partners & commissions
# ---------------------------------------------------------------------------
class PartnerPatch(BaseModel):
    status: Optional[Literal["pending", "approved", "rejected", "suspended"]] = None
    commission_type: Optional[Literal["percent", "flat"]] = None
    commission_value: Optional[float] = None
    pan: Optional[str] = None
    gst: Optional[str] = None
    bank: Optional[str] = None


class CommissionPatch(BaseModel):
    status: Literal["pending", "approved", "paid", "rejected"]


FIN_FIELDS = {"commission_type", "commission_value", "pan", "gst", "bank"}


@api.get("/partners")
async def list_partners(user=Depends(require(*ADMINS))):
    return await db.fetch(
        "select p.*, (select count(*) from leads l where l.org_id = p.org_id and l.cp_user_id = p.user_id) as leads, "
        "(select count(*) from leads l where l.org_id = p.org_id and l.cp_user_id = p.user_id and l.stage = 'closed_won') as won "
        "from partners p where p.org_id = $1 order by p.created_at desc", user["org_id"])


@api.patch("/partners/{partner_id}")
async def update_partner(partner_id: str, body: PartnerPatch, user=Depends(require(*ADMINS))):
    upd = body.model_dump(exclude_none=True)
    if not upd:
        raise HTTPException(400, "Nothing to update")
    if "status" in upd and user["role"] != "org_admin":
        raise HTTPException(403, "Only org admins can approve partners")
    p = await db.update("partners", W().add("id = ?", partner_id).add("org_id = ?", user["org_id"]), upd)
    if not p:
        raise HTTPException(404, "Partner not found")
    if "status" in upd and p["user_id"]:
        await notify(user["org_id"], p["user_id"], f"Partner account {upd['status']}", "Your RCortexa partner portal status changed", "partner", "/")
    await audit(user, "update", "partner", partner_id, ", ".join(upd.keys()))
    return p


@api.get("/partner/me")
async def partner_me(user=Depends(require("channel_partner"))):
    p = await db.fetchrow("select * from partners where org_id = $1 and user_id = $2", user["org_id"], user["id"])
    if not p:
        raise HTTPException(404, "Partner profile not found")
    return out(p, FIN_FIELDS)


@api.get("/commissions")
async def list_commissions(user=Depends(require("org_admin", "finance", "channel_partner"))):
    w = W().add("org_id = ?", user["org_id"])
    if user["role"] == "channel_partner":
        w.add("partner_user_id = ?", user["id"])
    items = await db.fetch(f"select * from commissions where {w.sql} order by created_at desc limit 500", *w.args)
    totals = {s: sum(i["amount"] for i in items if i["status"] == s) for s in ("pending", "approved", "paid")}
    return {"items": items, "totals": totals}


@api.patch("/commissions/{cid}")
async def update_commission(cid: str, body: CommissionPatch, user=Depends(require(*ADMINS))):
    st = body.status  # validated Literal → safe as a column-name prefix
    allowed_from = {"approved": ["pending"], "paid": ["approved"], "rejected": ["pending", "approved"], "pending": []}[st]
    w = W().add("id = ?", cid).add("org_id = ?", user["org_id"]).add("status = any(?::text[])", allowed_from)
    c = await db.update("commissions", w, {"status": st, f"{st}_at": now(), f"{st}_by": user["name"]})
    if not c:
        if not await db.fetchval("select 1 from commissions where id = $1 and org_id = $2", cid, user["org_id"]):
            raise HTTPException(404, "Commission not found")
        raise HTTPException(409, f"Commission cannot move to {st} from its current status")
    if c["partner_user_id"]:
        await notify(user["org_id"], c["partner_user_id"], f"Commission {st}", f"₹{c['amount']:,} for {c['lead_name']}", "commission", "/")
    await audit(user, st, "commission", cid, f"₹{c['amount']}")
    return c


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@api.get("/dashboard")
async def dashboard(user=Depends(require(*ORG_ROLES))):
    org_id = user["org_id"]
    scope = lead_scope(user)
    org, leads, _ = await asyncio.gather(get_org(org_id), db.fetch(f"select * from leads where {scope.sql}", *scope.args),
                                         release_expired(org_id) if user["role"] != "channel_partner" else asyncio.sleep(0))
    today = now().date()
    by_stage = {s: 0 for s in STAGES}
    by_source: dict[str, int] = {}
    tiers = {"Hot": 0, "Warm": 0, "Cold": 0}
    for ld in leads:
        by_stage[ld["stage"]] += 1
        by_source[ld["source"]] = by_source.get(ld["source"], 0) + 1
        if ld["tier"] in tiers and ld["stage"] not in OPEN:
            tiers[ld["tier"]] += 1
    base = {"org": org_view(org, user["role"]), "role": user["role"], "leads_today": sum(1 for x in leads if x["created_at"].date() == today),
            "leads_month": sum(1 for x in leads if (x["created_at"].year, x["created_at"].month) == (today.year, today.month)), "total_leads": len(leads),
            "by_stage": by_stage, "by_source": by_source, "tiers": tiers}
    if user["role"] == "channel_partner":
        p, comms = await asyncio.gather(
            db.fetchrow("select * from partners where org_id = $1 and user_id = $2", org_id, user["id"]),
            db.fetch("select amount, status from commissions where org_id = $1 and partner_user_id = $2", org_id, user["id"]))
        base["partner"] = out(p, FIN_FIELDS)
        base["commission_totals"] = {s: sum(c["amount"] for c in comms if c["status"] == s) for s in ("pending", "approved", "paid")}
        base["recent_leads"] = sorted(leads, key=lambda d: d["created_at"], reverse=True)[:5]
        return base
    sw = W().add("org_id = ?", org_id).add("status = 'sold'")
    if user["role"] == "sales_exec":
        sw.add("sold_by = ?", user["id"])
    vw = W().add("org_id = ?", org_id).add("status = 'scheduled'").add("scheduled_at >= now() - interval '2 hours'")
    if user["role"] == "sales_exec":
        vw.add("assigned_to = ?", user["id"])
    aw = W().add("a.org_id = ?", org_id)
    if user["role"] == "sales_exec":
        aw.add("l.assigned_to = ?", user["id"])
    is_admin = user["role"] in ADMINS
    inv_rows, sold, upcoming, recent, execs = await asyncio.gather(
        db.fetch("select status, count(*) n from units where org_id = $1 group by status", org_id),
        db.fetchrow(f"select count(*) n, coalesce(sum(coalesce(agreement_value, base_price)), 0) revenue from units where {sw.sql}", *sw.args),
        db.fetch(f"select * from site_visits where {vw.sql} order by scheduled_at limit 5", *vw.args),
        db.fetch(f"select a.* from activities a join leads l on l.id = a.lead_id where {aw.sql} order by a.created_at desc limit 8", *aw.args),
        db.fetch("select u.id, u.name, u.last_seen, (select count(*) from units x where x.org_id = u.org_id and x.status = 'sold' and x.sold_by = u.id) units_sold "
                 "from users u where u.org_id = $1 and u.role = 'sales_exec'", org_id) if is_admin else asyncio.sleep(0, result=[]),
    )
    inv = {s: 0 for s in ("available", "reserved", "sold", "blocked")}
    for r in inv_rows:
        inv[r["status"]] = r["n"]
    n_sold, revenue = sold["n"], int(sold["revenue"])
    avg_ticket = (revenue / n_sold) if n_sold else 9000000
    open_leads = [ld for ld in leads if ld["stage"] not in OPEN]
    forecast = sum(STAGE_PROB[ld["stage"]] * avg_ticket for ld in open_leads)
    closed = by_stage["closed_won"] + by_stage["closed_lost"]
    incentive = (org or {}).get("exec_incentive_per_unit") or 10000
    base.update({
        "inventory": inv, "revenue": revenue, "units_sold": n_sold,
        "conversion_rate": round(by_stage["closed_won"] / closed * 100, 1) if closed else 0,
        "forecast": {"revenue": round(forecast), "expected_bookings": round(sum(STAGE_PROB[ld["stage"]] for ld in open_leads), 1),
                     "assumption": f"Stage-weighted pipeline × avg ticket ₹{avg_ticket / 1e5:.0f}L"},
        "upcoming_visits": upcoming, "recent_activity": recent,
        "my_earnings": n_sold * incentive if user["role"] == "sales_exec" else None, "incentive_per_unit": incentive,
    })
    if is_admin:
        cutoff = now() - timedelta(minutes=5)
        team = []
        for e in execs:
            mine = [x for x in leads if x["assigned_to"] == e["id"]]
            team.append({"id": e["id"], "name": e["name"], "leads": len(mine), "won": sum(1 for x in mine if x["stage"] == "closed_won"),
                         "hot": sum(1 for x in mine if x["tier"] == "Hot" and x["stage"] not in OPEN),
                         "units_sold": e["units_sold"], "earnings": e["units_sold"] * incentive,
                         "online": bool(e["last_seen"] and e["last_seen"] > cutoff), "last_seen": e["last_seen"]})
        base["team"] = sorted(team, key=lambda t: -t["units_sold"])
        src_perf = []
        for s, n in by_source.items():
            won = sum(1 for x in leads if x["source"] == s and x["stage"] == "closed_won")
            visits = sum(1 for x in leads if x["source"] == s and STAGES.index(x["stage"]) >= 2 and x["stage"] != "closed_lost")
            src_perf.append({"source": s, "leads": n, "visits": visits, "won": won})
        base["source_performance"] = sorted(src_perf, key=lambda x: -x["leads"])
    return base


# ---------------------------------------------------------------------------
# AI assistant
# ---------------------------------------------------------------------------
class ChatIn(BaseModel):
    message: str


async def crm_context(user: dict) -> str:
    org_id = user["org_id"]
    await release_expired(org_id)
    lines = []
    groups = await db.fetch("select project_id, tower, facing, status, bhk, count(*) n, min(base_price) lo, max(base_price) hi from units "
                            "where org_id = $1 group by 1, 2, 3, 4, 5 order by 1, 2, 3", org_id)
    for p in await db.fetch("select * from projects where org_id = $1 and not archived order by created_at", org_id):
        lines.append(f"PROJECT {p['name']} ({p['location']}, {p['city']}) status={p['status']} towers={p['towers']}")
        for g in groups:
            if g["project_id"] == p["id"]:
                lines.append(f"  Tower {g['tower']} | {g['facing']}-facing | {g['bhk']}BHK | {g['status']}: {g['n']} units (₹{g['lo'] / 1e5:.0f}L–₹{g['hi'] / 1e5:.0f}L)")
    w = lead_scope(user)
    leads = await db.fetch(f"select * from leads where {w.sql} and stage not in ('closed_won','closed_lost') order by score desc limit 40", *w.args)
    lines.append(f"OPEN LEADS visible to user ({len(leads)} shown, sorted by score; closed deals excluded):")
    for ld in leads:
        lines.append(f"  {ld['name']} | stage={ld['stage']} | {ld['tier']} {ld['score']} | src={ld['source']} | {ld['bhk'] or '?'}BHK "
                     f"budget≤{(ld['budget_max'] or 0) / 1e5:.0f}L | facing={ld['preferred_facing']} | owner={ld['assigned_name']} | last={ld['last_activity_at']:%Y-%m-%d}")
    vw = W().add("org_id = ?", org_id).add("status = 'scheduled'")
    if user["role"] == "sales_exec":
        vw.add("assigned_to = ?", user["id"])
    for v in await db.fetch(f"select * from site_visits where {vw.sql} order by scheduled_at limit 15", *vw.args):
        lines.append(f"VISIT {v['lead_name']} @ {v['project_name']} on {v['scheduled_at']:%Y-%m-%d %H:%M} UTC")
    return "\n".join(lines)


@api.get("/ai/history")
async def ai_history(user=Depends(require(*INTERNAL))):
    return await db.fetch("select * from chat_messages where org_id = $1 and user_id = $2 order by created_at limit 200", user["org_id"], user["id"])


@api.delete("/ai/history")
async def ai_clear(user=Depends(require(*INTERNAL))):
    await db.execute("delete from chat_messages where org_id = $1 and user_id = $2", user["org_id"], user["id"])
    return {"ok": True}


@api.post("/ai/chat")
async def ai_chat(body: ChatIn, user=Depends(require(*INTERNAL))):
    msg = body.message.strip()
    if not msg:
        raise HTTPException(400, "Message required")
    if not ai.enabled():
        raise HTTPException(503, "AI assistant is not configured on this server")
    org_id, uid = user["org_id"], user["id"]
    history = await db.fetch("select role, content from chat_messages where org_id = $1 and user_id = $2 order by created_at desc limit 10", org_id, uid)
    await db.insert("chat_messages", {"org_id": org_id, "user_id": uid, "role": "user", "content": msg})
    ctx = await crm_context(user)
    system = ("You are RCortexa AI, the in-app CRM assistant for an Indian real-estate developer. Answer ONLY from the live CRM data below; "
              "if data is missing say so. Be concise, use ₹ with Lakh/Crore, short bullet points, and suggest one next action when useful. "
              f"Current user: {user['name']} ({user['role']}). Today: {now().strftime('%d %b %Y')}.\n\nLIVE CRM DATA:\n{ctx}")
    convo = "\n".join(f"{h['role'].upper()}: {h['content']}" for h in reversed(history))
    prompt = (f"Previous conversation:\n{convo}\n\n" if convo else "") + f"USER: {msg}"

    async def gen():
        parts = []
        try:
            async for delta in ai.stream(system, prompt):
                parts.append(delta)
                yield f"data: {json.dumps({'delta': delta})}\n\n"
        except Exception as e:
            logger.error("AI chat failed: %s", e)
            yield f"data: {json.dumps({'error': 'AI assistant is unavailable right now. Please retry.'})}\n\n"
        if parts:
            await db.insert("chat_messages", {"org_id": org_id, "user_id": uid, "role": "assistant", "content": "".join(parts)})
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# Users, notifications, audit
# ---------------------------------------------------------------------------
class UserIn(BaseModel):
    name: str
    email: str
    password: str
    role: Literal["finance", "sales_exec", "org_admin"]
    phone: str = ""


@api.get("/users")
async def list_users(user=Depends(require(*ADMINS))):
    rows = await db.fetch("select * from users where org_id = $1 and role <> 'channel_partner' order by name", user["org_id"])
    cutoff = now() - timedelta(minutes=5)
    return [out(r) | {"online": bool(r["last_seen"] and r["last_seen"] > cutoff)} for r in rows]


@api.post("/users")
async def create_user(body: UserIn, user=Depends(require("org_admin"))):
    email = body.email.strip().lower()
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    org = await get_org(user["org_id"])
    seats = await db.fetchval("select count(*) from users where org_id = $1 and role <> 'channel_partner'", user["org_id"])
    if org and seats >= org["seats"]:
        raise HTTPException(402, f"Seat limit reached ({org['seats']}). Upgrade your plan.")
    try:
        row = await db.insert("users", {"email": email, "name": body.name.strip(), "role": body.role, "org_id": user["org_id"],
                                        "password_hash": hash_pw(body.password), "phone": body.phone})
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "Email already registered")
    await audit(user, "create", "user", row["id"], f"{body.role} {email}")
    return out(row)


@api.get("/notifications")
async def notifications(user=Depends(current_user)):
    items = await db.fetch("select * from notifications where user_id = $1 order by created_at desc limit 50", user["id"])
    unread = await db.fetchval("select count(*) from notifications where user_id = $1 and not read", user["id"])
    return {"items": items, "unread": unread}


@api.post("/notifications/read")
async def notifications_read(user=Depends(current_user)):
    await db.execute("update notifications set read = true where user_id = $1 and not read", user["id"])
    return {"ok": True}


@api.get("/audit")
async def audit_logs(user=Depends(require("org_admin"))):
    return await db.fetch("select * from audit_logs where org_id = $1 order by created_at desc limit 200", user["org_id"])


# ---------------------------------------------------------------------------
# Global admin
# ---------------------------------------------------------------------------
PLANS = [{"id": "starter", "name": "Starter", "price": 4999, "seats": 5, "projects": 2, "ai_credits": 500},
         {"id": "growth", "name": "Growth", "price": 14999, "seats": 20, "projects": 10, "ai_credits": 3000},
         {"id": "enterprise", "name": "Enterprise", "price": 49999, "seats": 100, "projects": 100, "ai_credits": 20000}]


class OrgIn(BaseModel):
    name: str
    code: str
    plan: Literal["starter", "growth", "enterprise"] = "starter"
    city: str = ""
    admin_name: str
    admin_email: str
    admin_password: str


class OrgPatch(BaseModel):
    status: Optional[Literal["active", "suspended", "trial"]] = None
    plan: Optional[Literal["starter", "growth", "enterprise"]] = None
    renewal_date: Optional[str] = None


@api.get("/admin/overview")
async def admin_overview(user=Depends(require("global_admin"))):
    orgs = await db.fetch(
        "select o.*, (select count(*) from users u where u.org_id = o.id and u.role <> 'channel_partner') users, "
        "(select count(*) from leads l where l.org_id = o.id) leads, (select count(*) from projects p where p.org_id = o.id) projects "
        "from orgs o order by o.created_at desc")
    plan_price = {p["id"]: p["price"] for p in PLANS}
    soon = now() + timedelta(days=30)
    return {"orgs": orgs, "plans": PLANS, "metrics": {
        "orgs": len(orgs), "active": sum(1 for o in orgs if o["status"] == "active"), "suspended": sum(1 for o in orgs if o["status"] == "suspended"),
        "mrr": sum(plan_price.get(o["plan"], 0) for o in orgs if o["status"] == "active"),
        "renewals_30d": sum(1 for o in orgs if o["renewal_date"] and o["renewal_date"] <= soon),
        "total_users": await db.fetchval("select count(*) from users where role <> 'global_admin'")}}


@api.post("/admin/orgs")
async def admin_create_org(body: OrgIn, user=Depends(require("global_admin"))):
    code = body.code.strip().upper()
    email = body.admin_email.strip().lower()
    if len(body.admin_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    plan = next(p for p in PLANS if p["id"] == body.plan)
    try:
        async with db.tx() as c:
            org = await db.insert("orgs", {"name": body.name.strip(), "code": code, "plan": body.plan, "status": "trial", "seats": plan["seats"],
                                           "city": body.city, "renewal_date": now() + timedelta(days=14), "exec_incentive_per_unit": 10000}, conn=c)
            await db.insert("users", {"email": email, "name": body.admin_name, "role": "org_admin", "org_id": org["id"],
                                      "password_hash": hash_pw(body.admin_password)}, conn=c)
            await audit(user, "onboard", "org", org["id"], body.name, conn=c)
    except asyncpg.UniqueViolationError as e:
        raise HTTPException(409, "Organization code already exists" if "code" in str(e) else "Admin email already registered")
    return org


@api.patch("/admin/orgs/{org_id}")
async def admin_update_org(org_id: str, body: OrgPatch, user=Depends(require("global_admin"))):
    upd: dict[str, Any] = body.model_dump(exclude_none=True)
    if not upd:
        raise HTTPException(400, "Nothing to update")
    if "plan" in upd:
        upd["seats"] = next(p for p in PLANS if p["id"] == upd["plan"])["seats"]
    if "renewal_date" in upd:
        upd["renewal_date"] = parse_ts(upd["renewal_date"])
    o = await db.update("orgs", W().add("id = ?", org_id), upd)
    if not o:
        raise HTTPException(404, "Organization not found")
    await audit(user, "update", "org", org_id, ", ".join(f"{k}={v}" for k, v in body.model_dump(exclude_none=True).items()))
    return o


# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------
# Feature modules (import after the shared helpers above are defined)
from routes_inventory import router as inventory_router  # noqa: E402
from routes_subscription import router as subscription_router  # noqa: E402
from routes_attendance import router as attendance_router  # noqa: E402

app.include_router(api)
app.include_router(inventory_router)
app.include_router(subscription_router)
app.include_router(attendance_router)
# CORS is optional at import time so a missing Vercel environment variable
# cannot prevent the FastAPI function from starting. Configure the frontend
# origin(s) in Vercel for cross-origin browser requests. Same-origin requests
# do not require CORS.
cors_origins = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(asyncpg.PostgresError)
async def pg_error(request: Request, exc: asyncpg.PostgresError):
    logger.exception("Database error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "A database error occurred. Please retry."}, status_code=500)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


@app.on_event("shutdown")
async def shutdown():
    await db.close()
