"""Organization-admin Project & Inventory management: project/unit CRUD, assets, CSV/XLSX import & export."""
import csv
import io
from datetime import timedelta
from typing import Literal, Optional

import asyncpg
import jwt
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

import db
import storage
from db import W
from server import ADMINS, JWT_SECRET, ORG_ROLES, audit, mask_unit, now, release_expired, require

router = APIRouter(prefix="/api")

PROJECT_STATUSES = ("active", "upcoming", "completed")
PROJECT_TYPES = ("residential", "commercial", "mixed_use", "plots", "villas")
UNIT_TYPES = ("apartment", "villa", "plot", "office", "shop", "penthouse")
FACINGS = ("North", "East", "South", "West", "North-East", "North-West", "South-East", "South-West")
LOCKED_UNIT_FIELDS = {"tower", "floor", "unit_no", "bhk", "carpet_area", "super_area", "facing", "base_price", "unit_type"}
IMPORT_COLS = ["tower", "floor", "unit_no", "bhk", "carpet_area", "super_area", "facing", "base_price", "unit_type", "parking", "status", "notes"]
MAX_IMPORT_ROWS = 2000
ASSET_TYPES = {"image": {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}, "brochure": {"application/pdf": "pdf"}}
ASSET_TYPES["floor_plan"] = {**ASSET_TYPES["image"], **ASSET_TYPES["brochure"]}
MAX_BYTES = {"image": 10 * 1024 * 1024, "brochure": 25 * 1024 * 1024, "floor_plan": 15 * 1024 * 1024}


# ---------------------------------------------------------------------------
# Signed short-lived links (work for <img>, browser downloads and native alike)
# ---------------------------------------------------------------------------
def signed(payload: dict, hours: int = 12) -> str:
    return jwt.encode({**payload, "exp": now() + timedelta(hours=hours)}, JWT_SECRET, algorithm="HS256")


def unsign(token: str, typ: str) -> dict:
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Link expired — refresh and try again")
    if p.get("typ") != typ:
        raise HTTPException(401, "Invalid link")
    return p


def file_url(asset_id: Optional[str], org_id: str) -> Optional[str]:
    """Link valid until the end of tomorrow (UTC). Day-bucketed expiry keeps the URL stable so clients can cache the image."""
    if not asset_id:
        return None
    exp = now().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=2)
    token = jwt.encode({"typ": "file", "f": asset_id, "o": org_id, "exp": exp}, JWT_SECRET, algorithm="HS256")
    return f"/api/files/{asset_id}?t={token}"


def asset_out(a: dict) -> dict:
    return {k: v for k, v in a.items() if k != "storage_path"} | {"url": file_url(a["id"], a["org_id"])}


def project_out(p: dict) -> dict:
    return p | {"image_url": file_url(p["cover_asset_id"], p["org_id"]) or p.get("image_url"),
                "brochure_url": file_url(p["brochure_asset_id"], p["org_id"])}


async def get_project(user: dict, project_id: str, conn=None) -> dict:
    p = await db.fetchrow("select * from projects where id = $1 and org_id = $2", project_id, user["org_id"], conn=conn)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
class ProjectIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    project_type: Literal[PROJECT_TYPES] = "residential"  # type: ignore[valid-type]
    status: Literal[PROJECT_STATUSES] = "upcoming"  # type: ignore[valid-type]
    location: str = ""
    city: str = ""
    state: str = ""
    address: str = ""
    pincode: str = ""
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)
    description: str = Field("", max_length=4000)
    amenities: list[str] = []
    price_from: Optional[int] = Field(None, ge=0)
    rera: str = ""
    launch: str = ""
    possession_date: str = ""
    total_area: str = ""
    floors: int = Field(0, ge=0, le=200)
    towers: list[str] = []


class ProjectPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    project_type: Optional[Literal[PROJECT_TYPES]] = None  # type: ignore[valid-type]
    status: Optional[Literal[PROJECT_STATUSES]] = None  # type: ignore[valid-type]
    location: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    address: Optional[str] = None
    pincode: Optional[str] = None
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)
    description: Optional[str] = Field(None, max_length=4000)
    amenities: Optional[list[str]] = None
    price_from: Optional[int] = Field(None, ge=0)
    rera: Optional[str] = None
    launch: Optional[str] = None
    possession_date: Optional[str] = None
    total_area: Optional[str] = None
    floors: Optional[int] = Field(None, ge=0, le=200)
    towers: Optional[list[str]] = None
    cover_asset_id: Optional[str] = None


def clean_list(items: list[str]) -> list[str]:
    seen: list[str] = []
    for i in items:
        i = i.strip()
        if i and i not in seen:
            seen.append(i)
    return seen


@router.get("/projects")
async def list_projects(q: Optional[str] = None, status: Optional[str] = None, city: Optional[str] = None,
                        sort: Literal["created", "name", "price", "availability"] = "created", include_archived: bool = False,
                        user=Depends(require(*ORG_ROLES))):
    await release_expired(user["org_id"])
    w = W().add("org_id = ?", user["org_id"])
    if not (include_archived and user["role"] == "org_admin"):
        w.add("not archived")
    if status and status != "all":
        w.add("status = ?", status)
    if city:
        w.add("city ilike ?", city.strip())
    if q:
        pat = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        w.add("(name ilike ? or location ilike ? or city ilike ? or rera ilike ?)", pat, pat, pat, pat)
    order = {"created": "created_at", "name": "lower(name)", "price": "price_from nulls last", "availability": "created_at"}[sort]
    projects = await db.fetch(f"select * from projects where {w.sql} order by {order}", *w.args)
    stats_rows = await db.fetch("select project_id, status, count(*) n from units where org_id = $1 group by project_id, status", user["org_id"])
    res = []
    for p in projects:
        stats = {s: 0 for s in ("available", "reserved", "sold", "blocked")}
        for r in stats_rows:
            if r["project_id"] == p["id"]:
                stats[r["status"]] = r["n"]
        res.append(project_out(p) | {"stats": stats, "total_units": sum(stats.values())})
    if sort == "availability":
        res.sort(key=lambda x: -x["stats"]["available"])
    return res


@router.get("/projects/{project_id}")
async def project_detail(project_id: str, user=Depends(require(*ORG_ROLES))):
    p = await get_project(user, project_id)
    assets = await db.fetch("select * from project_assets where org_id = $1 and project_id = $2 and not is_deleted order by created_at", user["org_id"], project_id)
    stats = {s: 0 for s in ("available", "reserved", "sold", "blocked")}
    for r in await db.fetch("select status, count(*) n from units where org_id = $1 and project_id = $2 group by status", user["org_id"], project_id):
        stats[r["status"]] = r["n"]
    return project_out(p) | {"assets": [asset_out(a) for a in assets], "stats": stats, "total_units": sum(stats.values())}


@router.post("/projects")
async def create_project(body: ProjectIn, user=Depends(require("org_admin"))):
    name = body.name.strip()
    if await db.fetchval("select 1 from projects where org_id = $1 and lower(name) = lower($2) and not archived", user["org_id"], name):
        raise HTTPException(409, "A project with this name already exists")
    data = body.model_dump() | {"name": name, "org_id": user["org_id"], "towers": clean_list(body.towers), "amenities": clean_list(body.amenities)}
    p = await db.insert("projects", data)
    await audit(user, "create", "project", p["id"], name)
    return project_out(p)


@router.patch("/projects/{project_id}")
async def update_project(project_id: str, body: ProjectPatch, user=Depends(require("org_admin"))):
    p = await get_project(user, project_id)
    upd = body.model_dump(exclude_unset=True)
    for k in ("name", "project_type", "status", "floors", "amenities", "towers", "description", "location", "city", "state", "address", "pincode", "rera", "launch", "possession_date", "total_area"):
        if k in upd and upd[k] is None:
            upd.pop(k)
    if not upd:
        raise HTTPException(400, "Nothing to update")
    if "name" in upd:
        upd["name"] = upd["name"].strip()
        if await db.fetchval("select 1 from projects where org_id = $1 and lower(name) = lower($2) and id <> $3 and not archived", user["org_id"], upd["name"], project_id):
            raise HTTPException(409, "A project with this name already exists")
    if "towers" in upd:
        upd["towers"] = clean_list(upd["towers"])
        in_use = [r["tower"] for r in await db.fetch("select distinct tower from units where project_id = $1", project_id)]
        missing = [t for t in in_use if t not in upd["towers"]]
        if missing:
            raise HTTPException(409, f"Tower {', '.join(missing)} still has units — delete or move them first")
    if "amenities" in upd:
        upd["amenities"] = clean_list(upd["amenities"])
    if upd.get("cover_asset_id") and not await db.fetchval(
            "select 1 from project_assets where id = $1 and project_id = $2 and org_id = $3 and kind = 'image' and not is_deleted", upd["cover_asset_id"], project_id, user["org_id"]):
        raise HTTPException(400, "Cover must be one of this project's images")
    upd["updated_at"] = now()
    row = await db.update("projects", W().add("id = ?", project_id).add("org_id = ?", user["org_id"]), upd)
    await audit(user, "update", "project", project_id, ", ".join(k for k in upd if k != "updated_at"))
    return project_out(row) if row else project_out(p)


@router.delete("/projects/{project_id}")
async def archive_project(project_id: str, confirm: bool = False, user=Depends(require("org_admin"))):
    """Soft delete (archive). Refused while units are on hold; needs explicit confirmation when units are sold."""
    p = await get_project(user, project_id)
    counts = {r["status"]: r["n"] for r in await db.fetch("select status, count(*) n from units where project_id = $1 group by status", project_id)}
    if counts.get("reserved"):
        raise HTTPException(409, f"{counts['reserved']} unit(s) are on hold for buyers. Release them before archiving.")
    if counts.get("sold") and not confirm:
        raise HTTPException(409, f"{counts['sold']} unit(s) are sold. Confirm to archive — sales history is kept.")
    await db.execute("update projects set archived = true, updated_at = now() where id = $1", project_id)
    await audit(user, "archive", "project", project_id, p["name"])
    return {"ok": True}


@router.post("/projects/{project_id}/restore")
async def restore_project(project_id: str, user=Depends(require("org_admin"))):
    await get_project(user, project_id)
    await db.execute("update projects set archived = false, updated_at = now() where id = $1", project_id)
    await audit(user, "restore", "project", project_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------
class UnitIn(BaseModel):
    tower: str = Field(min_length=1, max_length=20)
    floor: int = Field(ge=-5, le=200)
    unit_no: str = Field(min_length=1, max_length=20)
    bhk: int = Field(ge=0, le=10)
    carpet_area: int = Field(gt=0, le=100000)
    super_area: Optional[int] = Field(None, gt=0, le=200000)
    facing: Literal[FACINGS]  # type: ignore[valid-type]
    base_price: int = Field(gt=0)
    unit_type: Literal[UNIT_TYPES] = "apartment"  # type: ignore[valid-type]
    parking: str = ""
    notes: str = Field("", max_length=2000)
    status: Literal["available", "blocked"] = "available"


class UnitPatch(BaseModel):
    tower: Optional[str] = Field(None, min_length=1, max_length=20)
    floor: Optional[int] = Field(None, ge=-5, le=200)
    unit_no: Optional[str] = Field(None, min_length=1, max_length=20)
    bhk: Optional[int] = Field(None, ge=0, le=10)
    carpet_area: Optional[int] = Field(None, gt=0, le=100000)
    super_area: Optional[int] = Field(None, gt=0, le=200000)
    facing: Optional[Literal[FACINGS]] = None  # type: ignore[valid-type]
    base_price: Optional[int] = Field(None, gt=0)
    unit_type: Optional[Literal[UNIT_TYPES]] = None  # type: ignore[valid-type]
    parking: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=2000)
    status: Optional[Literal["available", "blocked"]] = None
    confirm: bool = False


async def ensure_tower(project: dict, tower: str, floor: int, conn=None):
    towers = list(project["towers"] or [])
    if tower not in towers or floor > (project["floors"] or 0):
        await db.execute("update projects set towers = $2, floors = greatest(floors, $3), updated_at = now() where id = $1",
                         project["id"], towers + ([tower] if tower not in towers else []), floor, conn=conn)


@router.get("/projects/{project_id}/units")
async def project_units(project_id: str, tower: Optional[str] = None, facing: Optional[str] = None, status: Optional[str] = None,
                        bhk: Optional[int] = None, q: Optional[str] = None, min_price: Optional[int] = None, max_price: Optional[int] = None,
                        sort: Literal["floor", "price_asc", "price_desc", "area", "unit_no"] = "floor", user=Depends(require(*ORG_ROLES))):
    p = await get_project(user, project_id)
    await release_expired(user["org_id"])
    w = W().add("org_id = ?", user["org_id"]).add("project_id = ?", project_id)
    for col, val in (("tower", tower), ("facing", facing), ("status", status), ("bhk", bhk)):
        if val not in (None, ""):
            w.add(f"{col} = ?", val)
    if min_price:
        w.add("base_price >= ?", min_price)
    if max_price:
        w.add("base_price <= ?", max_price)
    if q:
        w.add("(unit_no ilike ? or tower ilike ?)", f"%{q.strip()}%", f"%{q.strip()}%")
    order = {"floor": "floor desc, unit_no", "price_asc": "base_price, unit_no", "price_desc": "base_price desc, unit_no",
             "area": "carpet_area desc, unit_no", "unit_no": "tower, unit_no"}[sort]
    units = await db.fetch(f"select * from units where {w.sql} order by {order}", *w.args)
    return {"project": project_out(p), "units": [mask_unit(u, user) for u in units]}


@router.post("/projects/{project_id}/units")
async def create_unit(project_id: str, body: UnitIn, user=Depends(require("org_admin"))):
    p = await get_project(user, project_id)
    data = body.model_dump() | {"tower": body.tower.strip(), "unit_no": body.unit_no.strip(), "org_id": user["org_id"], "project_id": project_id}
    try:
        async with db.tx() as c:
            u = await db.insert("units", data, conn=c)
            await ensure_tower(p, data["tower"], body.floor, conn=c)
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, f"Unit {data['tower']}-{data['unit_no']} already exists in this project")
    await audit(user, "create", "unit", u["id"], f"{u['tower']}-{u['unit_no']}")
    return mask_unit(u, user)


@router.patch("/units/{unit_id}")
async def update_unit(unit_id: str, body: UnitPatch, user=Depends(require("org_admin"))):
    cur = await db.fetchrow("select * from units where id = $1 and org_id = $2", unit_id, user["org_id"])
    if not cur:
        raise HTTPException(404, "Unit not found")
    upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "confirm" and (v is not None or k == "super_area")}
    changed = {k for k, v in upd.items() if cur.get(k) != v}
    if not changed:
        return mask_unit(cur, user)
    if cur["status"] in ("reserved", "sold"):
        if "status" in changed:
            raise HTTPException(409, f"This unit is {cur['status']} — use release/booking actions to change its status")
        locked = changed & LOCKED_UNIT_FIELDS
        if locked and not body.confirm:
            raise HTTPException(409, f"This unit is {cur['status']}. Confirm to change {', '.join(sorted(locked))}.")
    upd = {k: upd[k] for k in changed} | {"updated_at": now()}
    p = await db.fetchrow("select * from projects where id = $1", cur["project_id"])
    try:
        async with db.tx() as c:
            u = await db.fetchrow(
                f"update units set {', '.join(f'{k} = ${i + 3}' for i, k in enumerate(upd))}, version = version + 1 "
                "where id = $1 and version = $2 returning *", unit_id, cur["version"], *upd.values(), conn=c)
            if not u:
                raise HTTPException(409, "This unit was just changed by someone else. Reload and try again.")
            await ensure_tower(p, u["tower"], u["floor"], conn=c)
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "Another unit in this project already uses that tower and unit number")
    detail = ", ".join(sorted(changed)) + (f" (on {cur['status']} unit, confirmed)" if cur["status"] in ("reserved", "sold") else "")
    await audit(user, "update", "unit", unit_id, detail)
    return mask_unit(u, user)


@router.delete("/units/{unit_id}")
async def delete_unit(unit_id: str, user=Depends(require("org_admin"))):
    u = await db.fetchrow("delete from units where id = $1 and org_id = $2 and status in ('available','blocked') returning *", unit_id, user["org_id"])
    if not u:
        st = await db.fetchval("select status from units where id = $1 and org_id = $2", unit_id, user["org_id"])
        if not st:
            raise HTTPException(404, "Unit not found")
        raise HTTPException(409, f"A {st} unit cannot be deleted. Release or cancel the deal first.")
    await audit(user, "delete", "unit", unit_id, f"{u['tower']}-{u['unit_no']}")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Bulk import / export
# ---------------------------------------------------------------------------
def parse_rows(filename: str, data: bytes) -> list[dict]:
    name = filename.lower()
    if name.endswith(".xlsx"):
        import openpyxl
        try:
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception:
            raise HTTPException(400, "Could not read the Excel file. Save it as .xlsx and try again.")
        ws = wb.worksheets[0]
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
        if not rows:
            return []
        head = [str(h or "").strip().lower().replace(" ", "_") for h in rows[0]]
        return [{head[i]: ("" if v is None else str(v).strip()) for i, v in enumerate(r) if i < len(head)} for r in rows[1:] if any(v not in (None, "") for v in r)]
    if name.endswith(".csv"):
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(400, "CSV must be UTF-8 encoded")
        reader = csv.DictReader(io.StringIO(text))
        reader.fieldnames = [(f or "").strip().lower().replace(" ", "_") for f in (reader.fieldnames or [])]
        return [{k: (v or "").strip() for k, v in r.items() if k} for r in reader if any((v or "").strip() for v in r.values() if isinstance(v, str))]
    raise HTTPException(400, "Upload a .csv or .xlsx file")


def to_int(v: str) -> Optional[int]:
    v = v.replace(",", "").replace("₹", "").strip()
    if v == "":
        return None
    return int(float(v))


def validate_row(r: dict) -> tuple[Optional[dict], list[str]]:
    errs: list[str] = []
    out: dict = {}
    for k in ("tower", "unit_no"):
        if not r.get(k):
            errs.append(f"{k} is required")
        out[k] = r.get(k, "")
    for k, required in (("floor", True), ("bhk", True), ("carpet_area", True), ("base_price", True), ("super_area", False)):
        try:
            out[k] = to_int(r.get(k, ""))
        except ValueError:
            errs.append(f"{k} must be a number"); continue
        if out[k] is None and required:
            errs.append(f"{k} is required")
        elif out[k] is not None and k in ("carpet_area", "base_price", "super_area") and out[k] <= 0:
            errs.append(f"{k} must be greater than 0")
    facing = next((f for f in FACINGS if f.lower() == r.get("facing", "").lower()), None)
    if not facing:
        errs.append("facing must be one of " + ", ".join(FACINGS))
    out["facing"] = facing
    ut = (r.get("unit_type") or "apartment").lower()
    if ut not in UNIT_TYPES:
        errs.append("unit_type must be one of " + ", ".join(UNIT_TYPES))
    out["unit_type"] = ut
    st = (r.get("status") or "available").lower()
    if st not in ("available", "blocked"):
        errs.append("status can only be available or blocked (reserve/sell from the app)")
    out["status"] = st
    out["parking"] = r.get("parking", "")
    out["notes"] = r.get("notes", "")[:2000]
    return (None if errs else out), errs


@router.post("/projects/{project_id}/units/import")
async def import_units(project_id: str, file: UploadFile = File(...), dry_run: bool = Form(True), user=Depends(require("org_admin"))):
    p = await get_project(user, project_id)
    data = await file.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 5 MB)")
    rows = parse_rows(file.filename or "", data)
    if not rows:
        raise HTTPException(400, "The file has no data rows")
    if len(rows) > MAX_IMPORT_ROWS:
        raise HTTPException(400, f"Too many rows ({len(rows)}). Import at most {MAX_IMPORT_ROWS} per file.")
    existing = {(u["tower"], u["unit_no"]): u for u in await db.fetch("select id, tower, unit_no, status from units where project_id = $1", project_id)}
    errors, skipped, creates, updates, seen = [], [], [], [], set()
    for i, r in enumerate(rows, start=2):
        key = (r.get("tower", ""), r.get("unit_no", ""))
        ex = existing.get(key)
        if key in seen:
            errors.append({"row": i, "unit": "-".join(k for k in key if k), "errors": ["duplicate tower + unit_no in this file"]}); continue
        seen.add(key)
        if ex and ex["status"] in ("reserved", "sold"):
            skipped.append({"row": i, "unit": f"{key[0]}-{key[1]}", "reason": f"unit is {ex['status']} — left unchanged"}); continue
        row, errs = validate_row(r)
        if errs:
            errors.append({"row": i, "unit": "-".join(k for k in key if k), "errors": errs}); continue
        if ex:
            updates.append((ex["id"], row))
        else:
            creates.append(row)
    summary = {"rows": len(rows), "create": len(creates), "update": len(updates), "skipped": skipped, "errors": errors[:200],
               "error_count": len(errors), "dry_run": dry_run, "imported": False}
    if dry_run or errors:
        return summary
    cols = ["tower", "floor", "unit_no", "bhk", "carpet_area", "super_area", "facing", "base_price", "unit_type", "parking", "notes", "status"]
    async with db.tx() as c:
        if creates:
            await c.executemany(
                f"insert into units (id, org_id, project_id, {', '.join(cols)}) values ($1, $2, $3, {', '.join(f'${i + 4}' for i in range(len(cols)))})",
                [(db.new_id(), user["org_id"], project_id, *[r[k] for k in cols]) for r in creates])
        if updates:
            await c.executemany(
                f"update units set {', '.join(f'{k} = ${i + 2}' for i, k in enumerate(cols))}, updated_at = now(), version = version + 1 "
                "where id = $1 and status in ('available','blocked')", [(uid, *[r[k] for k in cols]) for uid, r in updates])
        all_rows = creates + [r for _, r in updates]
        towers = list(p["towers"] or [])
        for r in all_rows:
            if r["tower"] not in towers:
                towers.append(r["tower"])
        await db.execute("update projects set towers = $2, floors = greatest(floors, $3), updated_at = now() where id = $1",
                         project_id, towers, max(r["floor"] for r in all_rows), conn=c)
    await audit(user, "import", "units", project_id, f"{len(creates)} created, {len(updates)} updated, {len(skipped)} skipped")
    return summary | {"imported": True}


@router.post("/projects/{project_id}/units/export-link")
async def export_link(project_id: str, format: Literal["csv", "xlsx"] = "csv", template: bool = False, user=Depends(require(*ADMINS))):
    await get_project(user, project_id)
    token = signed({"typ": "export", "p": project_id, "o": user["org_id"], "u": user["id"], "fmt": format, "tpl": template}, hours=1)
    return {"url": f"/api/exports/{token}"}


@router.get("/exports/{token}")
async def export_units(token: str):
    t = unsign(token, "export")
    p = await db.fetchrow("select * from projects where id = $1 and org_id = $2", t["p"], t["o"])
    if not p:
        raise HTTPException(404, "Project not found")
    units = [] if t["tpl"] else await db.fetch("select * from units where project_id = $1 order by tower, floor, unit_no", t["p"])
    cols = IMPORT_COLS + ([] if t["tpl"] else ["reserved_until", "sold_at"])
    sample = [{"tower": "A", "floor": 1, "unit_no": "101", "bhk": 2, "carpet_area": 1150, "super_area": 1450, "facing": "North",
               "base_price": 8500000, "unit_type": "apartment", "parking": "1 covered", "status": "available", "notes": ""}]
    rows = [[("" if u.get(c) is None else u[c].isoformat() if hasattr(u.get(c), "isoformat") else u[c]) for c in cols] for u in (units or (sample if t["tpl"] else []))]
    slug = "".join(ch if ch.isalnum() else "-" for ch in p["name"].lower()).strip("-")
    fname = f"{slug}-{'template' if t['tpl'] else 'inventory'}.{t['fmt']}"
    if t["fmt"] == "xlsx":
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Units"
        ws.append(cols)
        for r in rows:
            ws.append(r)
        buf = io.BytesIO()
        wb.save(buf)
        body, mt = buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        sio = io.StringIO()
        wr = csv.writer(sio)
        wr.writerow(cols)
        wr.writerows(rows)
        body, mt = ("\ufeff" + sio.getvalue()).encode(), "text/csv"
    return Response(body, media_type=mt, headers={"Content-Disposition": f'attachment; filename="{fname}"', "Cache-Control": "no-store"})


# ---------------------------------------------------------------------------
# Assets (images, brochures, floor plans) — Emergent object storage
# ---------------------------------------------------------------------------
@router.post("/projects/{project_id}/assets")
async def upload_asset(project_id: str, file: UploadFile = File(...), kind: Literal["image", "brochure", "floor_plan"] = Form(...),
                       unit_id: Optional[str] = Form(None), user=Depends(require("org_admin"))):
    p = await get_project(user, project_id)
    ctype = (file.content_type or "").lower()
    if ctype == "image/jpg":
        ctype = "image/jpeg"
    ext = ASSET_TYPES[kind].get(ctype)
    if not ext:
        raise HTTPException(400, {"image": "Images must be JPG, PNG or WEBP", "brochure": "Brochures must be PDF", "floor_plan": "Floor plans must be an image or PDF"}[kind])
    if unit_id and not await db.fetchval("select 1 from units where id = $1 and project_id = $2 and org_id = $3", unit_id, project_id, user["org_id"]):
        raise HTTPException(404, "Unit not found")
    data = await file.read(MAX_BYTES[kind] + 1)
    if len(data) > MAX_BYTES[kind]:
        raise HTTPException(413, f"File too large (max {MAX_BYTES[kind] // (1024 * 1024)} MB)")
    if not data:
        raise HTTPException(400, "Empty file")
    try:
        path = await storage.put("media", user["org_id"], ext, data, ctype)
    except storage.StorageError as e:
        raise HTTPException(e.status, str(e))
    async with db.tx() as c:
        a = await db.insert("project_assets", {"org_id": user["org_id"], "project_id": project_id, "unit_id": unit_id, "kind": kind, "storage_path": path,
                                               "filename": (file.filename or f"file.{ext}")[:200], "content_type": ctype, "size": len(data), "uploaded_by": user["id"]}, conn=c)
        if kind == "image" and not unit_id and not p["cover_asset_id"]:
            await db.execute("update projects set cover_asset_id = $2, updated_at = now() where id = $1", project_id, a["id"], conn=c)
        if kind == "brochure":
            await db.execute("update projects set brochure_asset_id = $2, updated_at = now() where id = $1", project_id, a["id"], conn=c)
        if kind == "floor_plan" and unit_id:
            await db.execute("update units set floor_plan_asset_id = $2, updated_at = now() where id = $1", unit_id, a["id"], conn=c)
    await audit(user, "upload", kind, a["id"], a["filename"])
    return asset_out(a)


@router.get("/units/{unit_id}/assets")
async def unit_assets(unit_id: str, user=Depends(require(*ORG_ROLES))):
    rows = await db.fetch("select * from project_assets where unit_id = $1 and org_id = $2 and not is_deleted order by created_at", unit_id, user["org_id"])
    return [asset_out(a) for a in rows]


@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str, user=Depends(require("org_admin"))):
    async with db.tx() as c:
        a = await db.fetchrow("update project_assets set is_deleted = true where id = $1 and org_id = $2 and not is_deleted returning *", asset_id, user["org_id"], conn=c)
        if not a:
            raise HTTPException(404, "File not found")
        await db.execute("update projects set cover_asset_id = (select id from project_assets where project_id = $1 and kind = 'image' and unit_id is null and not is_deleted order by created_at limit 1) "
                         "where id = $1 and cover_asset_id = $2", a["project_id"], asset_id, conn=c)
        await db.execute("update projects set brochure_asset_id = null where id = $1 and brochure_asset_id = $2", a["project_id"], asset_id, conn=c)
        await db.execute("update units set floor_plan_asset_id = null where floor_plan_asset_id = $1", asset_id, conn=c)
    await audit(user, "delete", a["kind"], asset_id, a["filename"])
    return {"ok": True}


@router.get("/files/{asset_id}")
async def serve_file(asset_id: str, t: str = Query(...)):
    claims = unsign(t, "file")
    if claims.get("f") != asset_id:
        raise HTTPException(401, "Invalid link")
    a = await db.fetchrow("select * from project_assets where id = $1 and org_id = $2 and not is_deleted", asset_id, claims["o"])
    if not a:
        raise HTTPException(404, "File not found")
    try:
        return await storage.respond(a["storage_path"], a["content_type"], a["filename"])
    except storage.StorageError as e:
        raise HTTPException(e.status, str(e))
