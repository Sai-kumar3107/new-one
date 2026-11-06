"""Organization subscription & billing — visible to the Organization Admin only.

Plan definitions (PLANS) and plan changes stay with the global admin (/api/admin/*). Org admins can view
their plan, usage and history, and send a tracked change request. Billing fields are stripped from the
`org` object for every other role by `server.org_view`, so no other endpoint leaks them.
"""
import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import db
from server import PLANS, audit, get_org, notify, require

router = APIRouter(prefix="/api/org/subscription")


class PlanRequestIn(BaseModel):
    plan: Literal["starter", "growth", "enterprise"]
    note: str = Field("", max_length=500)


@router.get("")
async def org_subscription(user=Depends(require("org_admin"))):
    org = await get_org(user["org_id"])
    seats_used, projects_used, history = await asyncio.gather(
        db.fetchval("select count(*) from users where org_id = $1 and role <> 'channel_partner'", org["id"]),
        db.fetchval("select count(*) from projects where org_id = $1 and not archived", org["id"]),
        db.fetch("select action, detail, user_name, role, created_at from audit_logs where entity = 'org' and entity_id = $1 "
                 "and action in ('onboard','update','plan_request') order by created_at desc limit 50", org["id"]))
    plan = next((p for p in PLANS if p["id"] == org["plan"]), PLANS[0])
    return {"org": {k: org[k] for k in ("id", "name", "code", "status", "plan", "seats", "renewal_date")},
            "plan": plan, "billing_cycle": "monthly", "currency": "INR", "plans": PLANS,
            "usage": {"seats": seats_used, "seat_limit": org["seats"], "projects": projects_used, "project_limit": plan["projects"]},
            "history": history}


@router.post("/request")
async def org_plan_request(body: PlanRequestIn, user=Depends(require("org_admin"))):
    """Plan changes are applied by RCortexa (global admin); this records and notifies a request."""
    org = await get_org(user["org_id"])
    if body.plan == org["plan"]:
        raise HTTPException(400, "You are already on this plan")
    detail = f"{org['plan']} → {body.plan}" + (f" · {body.note.strip()}" if body.note.strip() else "")
    async with db.tx() as c:
        for g in await db.fetch("select id from users where role = 'global_admin' and is_active", conn=c):
            await notify(org["id"], g["id"], "Plan change request", f"{org['name']}: {detail}", "billing", "/admin", conn=c)
        await audit(user, "plan_request", "org", org["id"], detail, conn=c)
    return {"ok": True}
