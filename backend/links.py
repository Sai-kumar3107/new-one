"""Signed, short-lived links for resources that browsers load without an Authorization header
(<img src>, PDF viewers, downloads). Tokens are HS256 JWTs with a `typ` claim so a token minted for one
purpose can never be replayed against another endpoint. Each token also carries the viewer's user id
(`u`) so the serving endpoint can re-check that viewer's *current* permissions — revoking access takes
effect immediately, not when the link expires.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import HTTPException

from server import JWT_SECRET


def sign(payload: dict, minutes: int = 60, day_bucket: bool = False) -> str:
    """day_bucket=True gives an expiry at the end of tomorrow (UTC) so the URL is stable and clients can cache it."""
    now = datetime.now(timezone.utc)
    exp = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=2) if day_bucket else now + timedelta(minutes=minutes)
    return jwt.encode({**payload, "exp": exp}, JWT_SECRET, algorithm="HS256")


def verify(token: str, typ: str) -> dict:
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Link expired — refresh and try again")
    if claims.get("typ") != typ:
        raise HTTPException(401, "Invalid link")
    return claims


def link(path: str, typ: str, viewer: Optional[dict], minutes: int = 60, day_bucket: bool = False, **claims) -> str:
    token = sign({"typ": typ, "u": viewer["id"] if viewer else None, **claims}, minutes=minutes, day_bucket=day_bucket)
    return f"{path}?t={token}"
