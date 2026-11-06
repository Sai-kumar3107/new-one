# RCortexa — Setup, Migration & Vercel Deployment

One codebase, three clients: the **iOS/Android app** (Expo native), the **web app** (Expo web export, responsive for phone → desktop), and future clients. All of them use the same **REST API** (FastAPI, prefix `/api`). The API is documented live at `/api/docs` (OpenAPI JSON at `/api/openapi.json`).

```
frontend/   Expo Router app (native + web)  → Vercel project #1 (static web build)
backend/    FastAPI + asyncpg → Supabase    → Vercel project #2 (Python Function)
            schema.sql  manage.py  ai.py  db.py  api/index.py  vercel.json
```

## 1. Architecture changes from the original build
| Before | Now | Why |
|---|---|---|
| MongoDB (motor) | Supabase Postgres via `asyncpg` over the **transaction pooler** (port 6543, statement cache off, lazy pool) | Moving to Supabase; works with serverless functions |
| Seed data on server startup | `python manage.py migrate` / `seed`, run once | Vercel cold starts must not run migrations |
| `emergentintegrations` (not on public PyPI) | `openai` SDK against any OpenAI-compatible endpoint (`ai.py`) | Installs anywhere. The provider is set with environment variables |
| `CORS *` fallback | `CORS_ORIGINS` is required, as a comma-separated list | Locked to your own domains |
| Bare 500 errors | Global handlers log internally and return a generic message | Internal details are never leaked |
| — | `GET /api/health` → `{db, ai_enabled}` | Readiness check |

**What is unchanged:**
- Every endpoint path, request body and response shape is the same.
- All roles and RBAC rules.
- Tenant isolation (every query is scoped by `org_id`).
- Atomic reserve/booking. It is now a single conditional `UPDATE … RETURNING`, and booking runs in a transaction.
- bcrypt password hashes.
- JWT (HS256, 7 days) sent in the `Authorization: Bearer` header. The same flow works for mobile (token in Keychain/Keystore) and web (token in browser storage).

**Not supported on Vercel, and the replacement used:**
- **Background workers or cron for reservation expiry.** Not needed. Expired 48h holds are released lazily at the start of every inventory or booking request.
- **Long-lived DB connections.** Replaced by the Supabase pooler.

## 2. MongoDB → Postgres schema changes (`backend/schema.sql`)
- **IDs:** kept as 24-character hex `text` primary keys (same format as ObjectIds), generated in the app by `db.new_id()`.
- **Dates:** ISO strings became `timestamptz`.
- **Arrays:** `amenities` and `towers` became `text[]`.
- **Nested objects:** `engagement`, `score_factors` and activity `meta` became `jsonb`.
- **Foreign keys:**
  - users → orgs
  - projects/leads/units → orgs
  - units → projects
  - units/visits/commissions → leads
  - partners/commissions → users
  - `on delete` rules are chosen so that history is preserved.
- **Constraints:**
  - `unique(org_id, phone)` on leads (enforces duplicate-lead blocking at the database level)
  - `unique(project_id, tower, unit_no)` on units
  - `unique(email)` on users
  - `check` constraints on all status, role and stage fields
- **Dotted Mongo updates** (`engagement.choice`) became `jsonb ||`. Regex search became `ILIKE`. Aggregations became `GROUP BY`.
- **RLS** is enabled on every table, with no policies, and access is revoked from `anon` and `authenticated`. The Supabase public Data API therefore exposes nothing. Only the backend, connecting as the DB owner, can read data.

The schema script is idempotent (`create … if not exists`) and **never drops data**. You can run it in the Supabase SQL editor or with `python manage.py migrate`.

**MongoDB was not deleted.** You chose to start fresh with a small demo dataset. The old MongoDB data is untouched and remains available until you decide to remove it.

## 3. Environment variables
### Backend (Vercel project "rcortexa-api", all server-side only)
| Name | Example / notes |
|---|---|
| `SUPABASE_DB_URL` | `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`. Transaction pooler. **URL-encode special characters in the password** (`@` → `%40`), and do not keep the `[ ]` brackets from the template |
| `SUPABASE_DB_PASSWORD` | Optional. The raw database password. If set, it overrides the password inside `SUPABASE_DB_URL`, so no URL-encoding is needed |
| `JWT_SECRET` | 64+ random hex characters (`openssl rand -hex 32`). Reuse the current value to keep existing sessions valid |
| `CORS_ORIGINS` | `https://rcortexa-web.vercel.app,https://yourdomain.com` |
| `AI_API_KEY` | Optional. Your provider key. If it is unset, AI chat returns 503 and lead scoring falls back to the rules engine. Every other feature keeps working |
| `AI_BASE_URL` | Anthropic: `https://api.anthropic.com/v1/` · OpenAI: leave empty · Emergent Universal Key: `https://integrations.emergentagent.com/llm` (works outside Emergent today, but this is not an officially documented external use) |
| `AI_MODEL` | `claude-sonnet-4-5-20250929` (Anthropic/Emergent) or e.g. `gpt-4.1` (OpenAI) |
| `DB_POOL_MAX` | `3` (keep it small on serverless) |
| `SUPABASE_URL` | `https://<ref>.supabase.co`. **Required for file uploads** (project images, brochures, floor plans, attendance photos) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key. Server-side only, never in the frontend. Required together with `SUPABASE_URL` |

### Frontend (Vercel project "rcortexa-web")
| Name | Value |
|---|---|
| `EXPO_PUBLIC_BACKEND_URL` | `https://rcortexa-api.vercel.app` (no trailing slash, no `/api`) |

`EXPO_PUBLIC_*` values are embedded in the public bundle, so **never put secrets there**. All `.env` files are git-ignored.

## 4. Vercel settings
### Recommended: one Vercel project, no separate backend server
Import the repo with **Root Directory `/`** (the repo root). The root `vercel.json` does three things:
- Builds the web app (`frontend/dist`) as static files on Vercel's CDN.
- Serves `api/index.py`, the FastAPI app, as a serverless Python Function. It scales to zero and there is no server to manage.
- Rewrites `/api/*` to the function and every other path to the web app (SPA).

Because the web app and API share one domain, the browser needs no CORS. Set:
- `EXPO_PUBLIC_BACKEND_URL` = the project's own URL, e.g. `https://rcortexa.vercel.app`
- `CORS_ORIGINS` = the same URL

The native apps call the same `/api` URL.

**Where each piece of logic runs:**
| Layer | Runs on | What |
|---|---|---|
| Supabase Postgres | Supabase | All data. Constraints enforce uniqueness, valid statuses and referential integrity. The atomic reserve/booking guard is a conditional `UPDATE`. RLS blocks the public API |
| Vercel Python Function (`/api/*`) | Vercel | All 43 REST endpoints: |
| | | • auth (bcrypt + JWT) and RBAC |
| | | • tenant scoping |
| | | • lead scoring, smart assignment and duplicate locks |
| | | • booking, commission and partner workflows |
| | | • dashboards and audit log |
| | | • demo WhatsApp/voice flows |
| | | • AI streaming chat and AI scoring |
| Vercel CDN | Vercel | Responsive web app (Expo web export) |
| Device | Phone | Native app (same codebase), token in the secure keychain |

**Why the API isn't rewritten as Supabase client calls or Edge Functions:**
- Auth uses its own bcrypt+JWT so that existing passwords keep working.
- RBAC rules, such as hiding buyer details from sales staff and finance-only payout slabs, would need dozens of RLS policies.
- The AI provider keys must stay server-side.

Keeping FastAPI as a function preserves every endpoint exactly, with no long-running server.

**Performance:** `vercel.json` pins the function to region `syd1` (Sydney), the same region as your Supabase pooler (`aws-0-ap-southeast-2`), so each database round trip takes a few milliseconds. If you move the Supabase project, change `regions` to match it. Requests from a far-away region add about 300 ms per query.

### Single project: `EXPO_PUBLIC_BACKEND_URL`
If you do not set it, `scripts/vercel-build.sh` uses the project's own URL at build time (production domain for Production builds, the deployment URL for Previews). Set it explicitly if you serve the site from a custom domain, and add that domain to `CORS_ORIGINS`.

**Vercel limits:** request bodies on Functions are capped at about 4.5 MB, so uploads larger than that fail even though the app allows up to 25 MB. Set `regions` in `vercel.json` to the Vercel region closest to your Supabase project.

### Alternative: two Vercel projects
**Backend project:**
- Root Directory: `backend`
- Framework Preset: Other
- Build/Output: leave empty. `vercel.json` routes all paths to `api/index.py`, sets max duration to 60s, and Python version 3.12 comes from `.python-version`.
- Install: automatic, from `requirements.txt`.

**Frontend project:**
- Root Directory: `frontend`
- Framework Preset: Other
- Install: `yarn install --frozen-lockfile`
- Build: `npx expo export --platform web`
- Output: `dist`
- SPA rewrites and security headers are in `frontend/vercel.json`.

## 5. Deployment steps
1. In Supabase, open SQL Editor and paste `backend/schema.sql`, then Run. Alternatively, run `python manage.py migrate` locally.
2. Optionally, add demo data locally: `cd backend && pip install -r requirements.txt && python manage.py seed`.
3. On Vercel, import the GitHub repo **twice**: once with root `backend`, once with root `frontend`.
4. Add the environment variables above to each project (Production + Preview), then deploy the backend first.
5. Check `https://<api>/api/health`. It should return `{"status":"ok","db":true,...}`.
6. Set the frontend's `EXPO_PUBLIC_BACKEND_URL` to the API URL and deploy. Add the web URL to the backend's `CORS_ORIGINS` and redeploy the backend.
7. Native apps: build through Emergent → Publish, with `EXPO_PUBLIC_BACKEND_URL` pointing to your API.

## 6. Local development and testing
```
cd backend && pip install -r requirements-dev.txt
python manage.py migrate && python manage.py seed && python manage.py check
uvicorn server:app --reload --port 8001
cd frontend && yarn && EXPO_PUBLIC_BACKEND_URL=http://localhost:8001 npx expo start --web
```
Demo accounts are listed in `memory/test_credentials.md` (e.g. `orgadmin@skyline.com` / `Admin@123`). Change or remove them before going live.

## 7. Quick single-project checklist (this is the recommended setup)
1. Push this folder to GitHub (repo root = the folder containing `vercel.json`, `api/`, `backend/`, `frontend/`).
2. Vercel -> Add New Project -> import the repo. **Root Directory: `/`**. Framework Preset: **Other**. Leave Install/Build/Output empty (they come from `vercel.json`).
3. Environment Variables (Production + Preview): `JWT_SECRET`, `SUPABASE_DB_URL`, `CORS_ORIGINS` (your site URL). Optional: `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Leave `EXPO_PUBLIC_BACKEND_URL` unset (the build uses the project's own URL) unless you use a custom domain.
4. Run `backend/schema.sql` once in the Supabase SQL Editor.
5. Deploy, then open `/api/health`.
