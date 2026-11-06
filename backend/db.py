"""Postgres (Supabase) data access helpers built on asyncpg.

Designed for serverless (Vercel) and long-running servers alike:
- connects through the Supabase transaction pooler (statement cache disabled)
- the pool is created lazily and re-created if the event loop changes
"""
import asyncio
import json
import os
import secrets
from contextlib import asynccontextmanager
from typing import Any, Optional
from urllib.parse import unquote

import asyncpg

_pool: Optional[asyncpg.Pool] = None
_pool_loop: Optional[asyncio.AbstractEventLoop] = None


def new_id() -> str:
    return secrets.token_hex(12)


def connect_kwargs(url: str) -> dict:
    """Parse a postgres URL tolerantly (passwords containing '@' or other reserved characters)."""
    url = url.strip().strip('"').strip("'")
    if "://" not in url:
        raise RuntimeError("SUPABASE_DB_URL must start with postgresql://")
    rest = url.split("://", 1)[1]
    creds, hostpart = rest.rsplit("@", 1)
    user, password = creds.split(":", 1)
    hostport, _, dbq = hostpart.partition("/")
    database = (dbq.split("?", 1)[0] or "postgres")
    host, _, port = hostport.partition(":")
    return {"user": unquote(user), "password": unquote(password), "host": host, "port": int(port or 5432),
            "database": database, "ssl": "require"}


async def _init(conn: asyncpg.Connection):
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


_resolved: Optional[dict] = None


async def _resolve_kwargs() -> dict:
    """Probe the credentials once per process. If the password was saved with the Supabase template's
    literal "[ ]" brackets and is rejected, retry without them. The stored value is never modified."""
    global _resolved
    if _resolved is not None:
        return _resolved
    kw = connect_kwargs(os.environ["SUPABASE_DB_URL"])
    if os.environ.get("SUPABASE_DB_PASSWORD"):  # optional: raw password kept separately, no URL-encoding needed
        kw["password"] = os.environ["SUPABASE_DB_PASSWORD"]
    candidates = [kw]
    pw = kw["password"]
    if len(pw) > 2 and pw.startswith("[") and pw.endswith("]"):
        candidates.append({**kw, "password": pw[1:-1]})
    last_err: Optional[Exception] = None
    for cand in candidates:
        try:
            conn = await asyncpg.connect(**cand, statement_cache_size=0, timeout=15)
            await conn.close()
            _resolved = cand
            return cand
        except asyncpg.InvalidPasswordError as e:
            last_err = e
    raise last_err  # type: ignore[misc]


async def pool() -> asyncpg.Pool:
    global _pool, _pool_loop
    loop = asyncio.get_running_loop()
    if _pool is None or _pool_loop is not loop:
        _pool = await asyncpg.create_pool(
            **(await _resolve_kwargs()),
            min_size=0,
            max_size=int(os.environ.get("DB_POOL_MAX", "5")),
            statement_cache_size=0,
            command_timeout=30,
            max_inactive_connection_lifetime=60,
            init=_init,
        )
        _pool_loop = loop
    return _pool


async def close():
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def tx():
    p = await pool()
    async with p.acquire() as conn:
        async with conn.transaction():
            yield conn


async def fetch(sql: str, *args, conn=None) -> list[dict]:
    c = conn or await pool()
    return [dict(r) for r in await c.fetch(sql, *args)]


async def fetchrow(sql: str, *args, conn=None) -> Optional[dict]:
    c = conn or await pool()
    r = await c.fetchrow(sql, *args)
    return dict(r) if r else None


async def fetchval(sql: str, *args, conn=None) -> Any:
    c = conn or await pool()
    return await c.fetchval(sql, *args)


async def execute(sql: str, *args, conn=None) -> str:
    c = conn or await pool()
    return await c.execute(sql, *args)


async def insert(table: str, data: dict, conn=None) -> dict:
    data = {"id": new_id(), **data}
    cols = list(data.keys())
    sql = f"insert into {table} ({', '.join(cols)}) values ({', '.join(f'${i + 1}' for i in range(len(cols)))}) returning *"
    return await fetchrow(sql, *data.values(), conn=conn)


async def update(table: str, where: "W", data: dict, conn=None) -> Optional[dict]:
    """UPDATE table SET data... WHERE <where> RETURNING * (first row)."""
    sets, args = [], list(where.args)
    for k, v in data.items():
        args.append(v)
        sets.append(f"{k} = ${len(args)}")
    sql = f"update {table} set {', '.join(sets)} where {where.sql} returning *"
    return await fetchrow(sql, *args, conn=conn)


class W:
    """Tiny WHERE builder: w.add("org_id = ?", org) -> placeholders numbered $1..$n."""

    def __init__(self):
        self.parts: list[str] = []
        self.args: list[Any] = []

    def add(self, cond: str, *vals) -> "W":
        for v in vals:
            self.args.append(v)
            cond = cond.replace("?", f"${len(self.args)}", 1)
        self.parts.append(cond)
        return self

    @property
    def sql(self) -> str:
        return " and ".join(self.parts) or "true"

