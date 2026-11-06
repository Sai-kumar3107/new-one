"""Vercel entrypoint: runs the FastAPI app as a serverless Python Function.

Works from both layouts, so the same file is shipped as ./api/index.py (single project, Root Directory "/")
and ./backend/api/index.py (backend-only project, Root Directory "backend"). It puts whichever folder holds
server.py on sys.path, then imports the app.

If a required environment variable is missing, server.py would crash at import and Vercel would only show
"500 FUNCTION_INVOCATION_FAILED". Instead this serves a clear 503 that names the missing variable(s)
(names only, never values) so the fix is obvious. Once they are set, the real app is served unchanged.
"""
import os
import sys
from pathlib import Path

_here = Path(__file__).resolve().parent
for _p in (_here.parent, _here.parent / "backend"):
    if (_p / "server.py").exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

_REQUIRED = ("JWT_SECRET", "SUPABASE_DB_URL")
_missing = [name for name in _REQUIRED if not os.environ.get(name, "").strip()]

if _missing:
    print(f"[rcortexa] Missing required environment variable(s): {', '.join(_missing)}", file=sys.stderr)
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    app = FastAPI(title="RCortexa API (not configured)", docs_url=None, redoc_url=None, openapi_url=None)

    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
    async def _not_configured(path: str):
        return JSONResponse(
            {"detail": "Server is not configured. Set the missing environment variable(s) in Vercel and redeploy.",
             "missing": _missing},
            status_code=503,
        )
else:
    from server import app  # noqa: E402,F401
