"""File storage service — one interface, two private backends.

* Supabase Storage (preferred): used when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set. Buckets are
  created private on first use. Downloads go through our permission-checked API, which then redirects to a
  60-second signed URL — so no permanent public URL ever exists and large files don't stream through the
  serverless function.
* Emergent managed object storage (fallback): used when Supabase keys are absent. Bytes are proxied by the API.

Stored paths are self-describing, so files uploaded before a provider switch remain readable:
  "sb:<bucket>/<object path>"  → Supabase       "rcortexa/..." → Emergent
The service-role key never leaves the backend.
"""
import logging
import os
import uuid
from typing import Optional

import requests
from fastapi.responses import RedirectResponse, Response
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger("rcortexa.storage")

BUCKETS = {
    "media": os.environ.get("SUPABASE_MEDIA_BUCKET", "inventory-media"),
    "attendance": os.environ.get("SUPABASE_ATTENDANCE_BUCKET", "attendance-photos"),
}
SIGNED_URL_SECONDS = 60


class StorageError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# Supabase Storage (REST API, service role — server side only)
# ---------------------------------------------------------------------------
def _sb_conf() -> Optional[tuple[str, str]]:
    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    return (url, key) if url and key else None


_ready_buckets: set[str] = set()


def _sb(method: str, path: str, **kw) -> requests.Response:
    url, key = _sb_conf()  # type: ignore[misc]
    headers = {"Authorization": f"Bearer {key}", "apikey": key, **kw.pop("headers", {})}
    return requests.request(method, f"{url}/storage/v1/{path}", headers=headers, timeout=kw.pop("timeout", 60), **kw)


def _sb_ensure_bucket(bucket: str):
    if bucket in _ready_buckets:
        return
    r = _sb("POST", "bucket", json={"id": bucket, "name": bucket, "public": False})
    if r.status_code not in (200, 201) and "already exists" not in r.text.lower() and r.status_code != 409:
        logger.error("supabase bucket %s -> %s %s", bucket, r.status_code, r.text[:200])
        raise StorageError(503, "File storage is not configured correctly")
    _ready_buckets.add(bucket)


def _sb_put(bucket: str, path: str, data: bytes, ctype: str) -> str:
    _sb_ensure_bucket(bucket)
    r = _sb("POST", f"object/{bucket}/{path}", data=data, headers={"Content-Type": ctype, "x-upsert": "false"}, timeout=120)
    if r.status_code >= 400:
        logger.error("supabase upload -> %s %s", r.status_code, r.text[:200])
        raise StorageError(502, "Upload failed. Please retry.")
    return f"sb:{bucket}/{path}"


def _sb_signed(stored: str, filename: str, download: bool) -> str:
    bucket, path = stored[3:].split("/", 1)
    r = _sb("POST", f"object/sign/{bucket}/{path}", json={"expiresIn": SIGNED_URL_SECONDS})
    if r.status_code >= 400:
        raise StorageError(404 if r.status_code in (400, 404) else 502, "File not available")
    url, _ = _sb_conf()  # type: ignore[misc]
    signed = r.json().get("signedURL") or r.json().get("signedUrl")
    return f"{url}/storage/v1{signed}" + (f"&download={requests.utils.quote(filename)}" if download else "")


def _sb_delete(stored: str):
    bucket, path = stored[3:].split("/", 1)
    _sb("DELETE", f"object/{bucket}", json={"prefixes": [path]})


# ---------------------------------------------------------------------------
# Emergent managed object storage (fallback)
# ---------------------------------------------------------------------------
_EM_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
_EM_URL = _EM_BASE.rstrip("/") + "/objstore/api/v1/storage"
_em_key: Optional[str] = None


def _em_init() -> str:
    global _em_key
    if _em_key:
        return _em_key
    emergent_key = os.environ.get("EMERGENT_LLM_KEY")
    if not emergent_key:
        raise StorageError(503, "File storage is not configured on this server")
    r = requests.post(f"{_EM_URL}/init", json={"emergent_key": emergent_key}, timeout=30)
    if r.status_code != 200:
        raise StorageError(503, "File storage is unavailable right now")
    _em_key = r.json()["storage_key"]
    return _em_key


def _em_call(method: str, path: str, **kw) -> requests.Response:
    global _em_key
    r = None
    for attempt in range(2):
        r = requests.request(method, f"{_EM_URL}/objects/{path}", headers={"X-Storage-Key": _em_init(), **kw.get("headers", {})},
                             data=kw.get("data"), timeout=120)
        if r.status_code == 503 and attempt == 0:  # stale storage key → re-init once
            _em_key = None
            continue
        break
    if r.status_code == 402:
        raise StorageError(402, "Storage credits exhausted — uploads are paused. Existing files still open.")
    if r.status_code >= 400:
        raise StorageError(502, "File storage request failed. Please retry.")
    return r


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def provider() -> str:
    return "supabase" if _sb_conf() else "emergent"


async def put(area: str, org_id: str, ext: str, data: bytes, content_type: str) -> str:
    """Store bytes privately; returns the stored path to save in the database. area: 'media' | 'attendance'."""
    obj = f"{org_id}/{uuid.uuid4().hex}.{ext}"
    if _sb_conf():
        return await run_in_threadpool(_sb_put, BUCKETS[area], obj, data, content_type)
    path = f"rcortexa/uploads/{area}/{obj}"
    return (await run_in_threadpool(lambda: _em_call("PUT", path, data=data, headers={"Content-Type": content_type}))).json()["path"]


async def respond(stored: str, content_type: str, filename: str = "file", download: bool = False) -> Response:
    """HTTP response for an already-authorized read: signed-URL redirect (Supabase) or proxied bytes (Emergent)."""
    if stored.startswith("sb:"):
        url = await run_in_threadpool(_sb_signed, stored, filename, download)
        return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})
    r = await run_in_threadpool(_em_call, "GET", stored)
    disp = f'{"attachment" if download else "inline"}; filename="{filename}"'
    return Response(r.content, media_type=content_type, headers={"Cache-Control": "private, max-age=3600", "Content-Disposition": disp})


async def delete(stored: str):
    """Best-effort physical delete (Supabase only; Emergent storage has no delete API — rows are soft-deleted)."""
    if stored.startswith("sb:") and _sb_conf():
        try:
            await run_in_threadpool(_sb_delete, stored)
        except Exception:  # noqa: BLE001 - deletion failure must not break the caller
            logger.warning("supabase delete failed for %s", stored)
