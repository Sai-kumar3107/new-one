-- RCortexa schema for Supabase Postgres. Idempotent: safe to run repeatedly, never drops data.
-- IDs are 24-char hex text (same format as the previous MongoDB ObjectIds) so API ids/links stay stable.

create table if not exists orgs (
  id text primary key,
  name text not null,
  code text not null unique,
  plan text not null default 'starter' check (plan in ('starter','growth','enterprise')),
  status text not null default 'trial' check (status in ('active','suspended','trial')),
  seats int not null default 5,
  city text not null default '',
  renewal_date timestamptz,
  exec_incentive_per_unit int not null default 10000,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  email text not null unique,
  name text not null,
  role text not null check (role in ('global_admin','org_admin','finance','sales_exec','channel_partner')),
  org_id text references orgs(id) on delete restrict,
  password_hash text not null,
  is_active boolean not null default true,
  phone text not null default '',
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  check (role = 'global_admin' or org_id is not null)
);
create index if not exists users_org_idx on users(org_id, role);

create table if not exists projects (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  name text not null,
  location text not null default '',
  city text not null default '',
  lat double precision,
  lng double precision,
  status text not null default 'active' check (status in ('active','upcoming','completed')),
  description text not null default '',
  amenities text[] not null default '{}',
  price_from bigint,
  image_url text,
  towers text[] not null default '{}',
  floors int not null default 0,
  launch text,
  rera text,
  created_at timestamptz not null default now()
);
create index if not exists projects_org_idx on projects(org_id);

create table if not exists leads (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  name text not null,
  phone text not null,
  email text not null default '',
  source text not null default 'manual',
  project_id text references projects(id) on delete set null,
  project_name text,
  budget_min double precision,
  budget_max double precision,
  bhk int,
  preferred_facing text,
  location text not null default '',
  timeline text not null default '',
  notes text not null default '',
  stage text not null default 'new' check (stage in ('new','contacted','site_visit_scheduled','negotiation','closed_won','closed_lost')),
  assigned_to text references users(id) on delete set null,
  assigned_name text,
  cp_user_id text references users(id) on delete set null,
  cp_name text,
  locked boolean not null default false,
  lock_expires_at timestamptz,
  qualified boolean not null default false,
  engagement jsonb not null default '{}'::jsonb,
  callback_at timestamptz,
  score int not null default 0,
  tier text,
  score_factors jsonb not null default '[]'::jsonb,
  next_action text,
  score_source text,
  score_confidence real,
  scored_at timestamptz,
  lost_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  unique (org_id, phone)
);
create index if not exists leads_org_stage_idx on leads(org_id, stage);
create index if not exists leads_assigned_idx on leads(org_id, assigned_to);
create index if not exists leads_cp_idx on leads(org_id, cp_user_id);

create table if not exists units (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  project_id text not null references projects(id) on delete cascade,
  tower text not null,
  floor int not null,
  unit_no text not null,
  bhk int not null,
  carpet_area int not null,
  facing text not null,
  base_price bigint not null,
  status text not null default 'available' check (status in ('available','reserved','sold','blocked')),
  version int not null default 0,
  reserved_until timestamptz,
  lead_id text references leads(id) on delete set null,
  reserved_by text,
  reserved_by_name text,
  buyer_name text,
  buyer_phone text,
  sold_by text references users(id) on delete set null,
  sold_by_name text,
  sold_at timestamptz,
  agreement_value bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, tower, unit_no)
);
create index if not exists units_org_project_idx on units(org_id, project_id, tower);
create index if not exists units_status_idx on units(org_id, status);

create table if not exists activities (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  lead_id text not null references leads(id) on delete cascade,
  type text not null,
  text text not null,
  user_id text,
  user_name text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activities_lead_idx on activities(org_id, lead_id, created_at desc);

create table if not exists site_visits (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  lead_id text not null references leads(id) on delete cascade,
  lead_name text,
  lead_phone text,
  project_id text not null references projects(id) on delete cascade,
  project_name text,
  location text,
  maps_url text,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  assigned_to text references users(id) on delete set null,
  assigned_name text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists visits_org_idx on site_visits(org_id, status, scheduled_at);

create table if not exists partners (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  user_id text unique references users(id) on delete set null,
  name text not null,
  email text not null default '',
  phone text not null default '',
  agency text not null,
  rera_id text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  commission_type text not null default 'percent' check (commission_type in ('percent','flat')),
  commission_value double precision not null default 1.5,
  pan text not null default '',
  gst text not null default '',
  bank text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists partners_org_idx on partners(org_id);

create table if not exists commissions (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  partner_id text not null references partners(id) on delete restrict,
  partner_user_id text references users(id) on delete set null,
  agency text,
  lead_id text references leads(id) on delete set null,
  lead_name text,
  unit_id text references units(id) on delete set null,
  unit_label text,
  agreement_value bigint,
  amount bigint not null,
  milestone text,
  status text not null default 'pending' check (status in ('pending','approved','paid','rejected')),
  pending_at timestamptz, pending_by text,
  approved_at timestamptz, approved_by text,
  paid_at timestamptz, paid_by text,
  rejected_at timestamptz, rejected_by text,
  created_at timestamptz not null default now()
);
create index if not exists commissions_org_idx on commissions(org_id, partner_user_id);

create table if not exists chat_messages (
  id text primary key,
  org_id text not null references orgs(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_user_idx on chat_messages(org_id, user_id, created_at);

create table if not exists audit_logs (
  id text primary key,
  org_id text,
  user_id text,
  user_name text,
  role text,
  action text not null,
  entity text not null,
  entity_id text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists audit_org_idx on audit_logs(org_id, created_at desc);

create table if not exists notifications (
  id text primary key,
  org_id text,
  user_id text not null references users(id) on delete cascade,
  title text not null,
  body text not null default '',
  kind text not null default 'info',
  link text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);

-- Project & inventory management (additive)
alter table projects add column if not exists project_type text not null default 'residential';
alter table projects add column if not exists address text not null default '';
alter table projects add column if not exists state text not null default '';
alter table projects add column if not exists pincode text not null default '';
alter table projects add column if not exists possession_date text not null default '';
alter table projects add column if not exists total_area text not null default '';
alter table projects add column if not exists cover_asset_id text;
alter table projects add column if not exists brochure_asset_id text;
alter table projects add column if not exists archived boolean not null default false;
alter table projects add column if not exists updated_at timestamptz not null default now();
alter table units add column if not exists unit_type text not null default 'apartment';
alter table units add column if not exists super_area int;
alter table units add column if not exists parking text not null default '';
alter table units add column if not exists notes text not null default '';
alter table units add column if not exists floor_plan_asset_id text;

create table if not exists project_assets (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  project_id text not null references projects(id) on delete cascade,
  unit_id text references units(id) on delete set null,
  kind text not null check (kind in ('image','brochure','floor_plan')),
  storage_path text not null,
  filename text not null default '',
  content_type text not null,
  size int not null default 0,
  uploaded_by text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists project_assets_idx on project_assets(org_id, project_id, is_deleted);

-- Attendance (additive) ------------------------------------------------------
alter table orgs add column if not exists timezone text not null default 'Asia/Kolkata';
alter table orgs add column if not exists attendance_location_enabled boolean not null default false;
alter table orgs add column if not exists attendance_photo_retention_days int not null default 90;

create table if not exists attendance (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  user_id text not null references users(id) on delete cascade,
  user_name text not null default '',
  date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  check_in_photo text,
  check_out_photo text,
  check_in_lat double precision, check_in_lng double precision,
  check_out_lat double precision, check_out_lng double precision,
  status text not null default 'open' check (status in ('open','present','corrected')),
  source text not null default 'camera' check (source in ('camera','exception','admin')),
  duration_minutes int,
  photos_purged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id, date)
);
create index if not exists attendance_org_date_idx on attendance(org_id, date);

create table if not exists attendance_corrections (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  attendance_id text not null references attendance(id) on delete cascade,
  admin_id text, admin_name text not null default '',
  reason text not null,
  before text not null default '{}',
  after text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists attendance_corrections_idx on attendance_corrections(org_id, attendance_id);

create table if not exists attendance_exceptions (
  id text primary key,
  org_id text not null references orgs(id) on delete restrict,
  user_id text not null references users(id) on delete cascade,
  user_name text not null default '',
  kind text not null check (kind in ('check_in','check_out')),
  reason text not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by text, decided_at timestamptz, decision_note text not null default '',
  attendance_id text,
  created_at timestamptz not null default now()
);
create index if not exists attendance_exceptions_idx on attendance_exceptions(org_id, status);

-- Lock down Supabase's public Data API: RLS on, no policies => anon/authenticated roles get nothing.
-- The FastAPI backend connects as the database owner and enforces tenant isolation + RBAC itself.
do $$
declare t text;
begin
  foreach t in array array['orgs','users','projects','leads','units','activities','site_visits','partners','commissions','chat_messages','audit_logs','notifications','project_assets','attendance','attendance_corrections','attendance_exceptions']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated', t);
  end loop;
end $$;
