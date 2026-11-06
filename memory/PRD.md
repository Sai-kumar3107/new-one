# RCortexa — PRD

## Original problem statement
Build RCortexa, "The AI Brain Behind Real Estate": an AI-powered real-estate CRM and developer sales SaaS for India, based on the attached Master Build Prompt and the 47-feature roadmap. User asked to add their logo.

## User choices
- First build: Core CRM MVP + Channel Partner portal & commissions
- AI: Claude Sonnet 4.5 (Emergent LLM key)
- Auth: JWT email/password with 5 roles
- WhatsApp / AI voice / ad portals: clearly labeled DEMO mode
- Backend: the user wanted Supabase but skipped the keys, then chose FastAPI + MongoDB with tenant isolation enforced on the server

## Architecture
- Expo Router app (dark luxe theme, SpaceGrotesk + Plus Jakarta fonts, Ionicons). Uses NativeTabs on iOS 26+ and JS Tabs elsewhere.
- FastAPI (`/app/backend/server.py`) + MongoDB. Every query is scoped by org_id. RBAC is checked per endpoint. Audit logs are kept. Seed data is idempotent.
- Claude Sonnet 4.5 is used for streaming SSE assistant chat (with live CRM context) and for AI lead scoring. Rule-based scoring is the fallback.

## Implemented (Oct 2026)
- Role login and partner self-signup (org code). Global Admin console: onboard, suspend, reactivate, plans, MRR.
- Leads:
  - Capture with duplicate blocking, smart assignment by lowest workload, rule and AI scoring with explanations
  - Pipeline stages and activity timeline
  - Click-to-call and WhatsApp deep links
  - Demo instant WhatsApp, AI voice qualification and callback scheduling
- Projects and unit inventory:
  - Color-coded floor grid with tower, facing and status filters
  - Atomic reserve (48h) and booking with double-booking prevention, plus release and block
  - Buyer and executive details restricted to Admin/Finance
- AI property recommendations (match % with reasons). Site visits with demo maps confirmation.
- Channel partners:
  - Lead locking for 90 days
  - Payout slabs, PAN, GST and bank details visible to Admin/Finance only
  - Commission calculated automatically on booking, with an approve → paid workflow
- Dashboards:
  - KPIs, AI forecast, lead temperature, inventory, pipeline
  - Team performance and incentive earnings, marketing source performance
  - Partner home
- Team list with live online status and seat limits. Notifications, audit log, integrations status.

## Backlog
- P0: Real WhatsApp Business API and voice AI provider. Meta/Google/portal webhooks for lead intake.
- P1: Excel report export. Photo + GPS site attendance. Profile pictures (object storage). Interactive floor plans. Future-launch alerts campaign. Configurable stages.
- P2: Subscription billing (Stripe/Razorpay). Working-hour/IP restrictions. Push notifications. Migrating to Supabase once the user provides keys.

## Iteration 4 (Jun 2026) — Project & Inventory Management (org admin)
- Backend: routes_inventory.py (project CRUD/archive/restore, unit CRUD w/ reserved/sold safeguards, CSV+XLSX import (dry-run, all-or-nothing) & export via signed links, assets via Emergent object storage (storage.py), signed file URLs). Schema additive: project/unit columns + project_assets table.
- Frontend: /manage/projects, /manage/project/[id] (Units/Details/Photos & brochure tabs), /manage/unit/[id]; entry from Inventory "Manage" + Profile.
- Iteration-3 fixes verified by testing agent (iteration 4). Post-test fixes applied (re-import skip reserved/sold before validation, search escaping, router.back fallback, rescoring when leaving closed_won) — retest pending.
- Next: Team Management (current JWT + secure invite links, Emergent managed email).
