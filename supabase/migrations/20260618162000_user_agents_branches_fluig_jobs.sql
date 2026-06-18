create extension if not exists "pgcrypto";

create table if not exists public.app_branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  fluig_label text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text unique,
  display_name text not null,
  role text not null default 'LEITURA' check (
    role in ('ADMIN_MASTER', 'ADMIN', 'GERENTE_CD', 'FINANCEIRO', 'COMPRAS', 'MANUTENCAO', 'LEITURA')
  ),
  fluig_username text,
  fluig_user_id text,
  home_branch_id uuid references public.app_branches(id) on delete set null,
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_user_branch_access (
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  branch_id uuid not null references public.app_branches(id) on delete cascade,
  can_view boolean not null default true,
  can_create boolean not null default true,
  is_home boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);

create table if not exists public.fluig_user_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  display_name text not null,
  machine_id text,
  machine_name text,
  token_hash text not null unique,
  token_prefix text not null,
  status text not null default 'offline' check (status in ('online', 'offline', 'disabled')),
  local_api_url text,
  agent_version text,
  capabilities jsonb not null default '[]'::jsonb,
  last_heartbeat_at timestamptz,
  paired_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fluig_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by_user_id uuid not null references public.app_user_profiles(id) on delete cascade,
  assigned_agent_id uuid references public.fluig_user_agents(id) on delete set null,
  module_slug text not null check (module_slug in ('pagamentos', 'compras', 'manutencao', 'fornecedores')),
  operation text not null check (
    operation in ('sync_history', 'sync_status', 'open_from_source', 'cancel_request', 'health_check')
  ),
  status text not null default 'queued' check (
    status in (
      'queued',
      'agent_claimed',
      'authenticating',
      'opening_fluig',
      'reading_page',
      'filling_form',
      'submitting',
      'waiting_protocol',
      'syncing_result',
      'success',
      'error',
      'cancelled',
      'expired'
    )
  ),
  branch_id uuid references public.app_branches(id) on delete set null,
  branch_code text,
  branch_label text,
  fluig_username text,
  priority smallint not null default 5,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  error_message text,
  progress_stage text,
  progress_label text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fluig_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.fluig_jobs(id) on delete cascade,
  agent_id uuid references public.fluig_user_agents(id) on delete set null,
  event_type text not null,
  stage text,
  label text,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.fluig_requests
  add column if not exists branch_id uuid references public.app_branches(id) on delete set null,
  add column if not exists branch_code text,
  add column if not exists branch_label text,
  add column if not exists created_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  add column if not exists fluig_requester_login text,
  add column if not exists fluig_requester_code text;

insert into public.app_branches (code, name, fluig_label, metadata)
values
  ('CD_PRINCIPAL', 'CD Principal', 'CD Principal', '{"seed": true}'::jsonb),
  ('1007', '1007 - SIA', '1007 - 1007-SIA', '{"seed": true}'::jsonb),
  ('1052', '1052 - RFUNDO1', '1052 - 1052-RFUNDO1', '{"seed": true}'::jsonb),
  ('1060', '1060 - SAM FUR', '1060 - 1060-SAM FUR', '{"seed": true}'::jsonb),
  ('1062', '1062 - LUZIANIA 2', '1062 - 1062-LUZIANIA 2', '{"seed": true}'::jsonb)
on conflict (code) do nothing;

insert into public.app_branches (code, name, fluig_label, metadata)
select distinct
  nullif(split_part(trim(fields->>'unidadeFilial'), ' ', 1), '') as code,
  trim(fields->>'unidadeFilial') as name,
  trim(fields->>'unidadeFilial') as fluig_label,
  '{"source": "fluig_history"}'::jsonb
from (
  select raw_payload->'formFields' as fields
  from public.fluig_requests
) source
where trim(coalesce(fields->>'unidadeFilial', '')) <> ''
  and trim(fields->>'unidadeFilial') !~* '^\[object'
on conflict (code) do update
set fluig_label = coalesce(public.app_branches.fluig_label, excluded.fluig_label),
    updated_at = now();

update public.fluig_requests request
set
  branch_code = coalesce(
    nullif(request.branch_code, ''),
    nullif(split_part(trim(request.raw_payload->'formFields'->>'unidadeFilial'), ' ', 1), '')
  ),
  branch_label = coalesce(
    nullif(request.branch_label, ''),
    nullif(trim(request.raw_payload->'formFields'->>'unidadeFilial'), '')
  )
where request.raw_payload ? 'formFields';

update public.fluig_requests
set branch_id = null,
    branch_code = null,
    branch_label = null
where branch_code = '[object'
   or branch_label ~* '^\[object';

delete from public.app_branches
where code = '[object'
   or name ~* '^\[object'
   or fluig_label ~* '^\[object';

update public.fluig_requests request
set branch_id = branch.id
from public.app_branches branch
where request.branch_id is null
  and request.branch_code = branch.code;

create index if not exists app_user_profiles_auth_user_id_idx on public.app_user_profiles (auth_user_id);
create index if not exists app_user_profiles_email_idx on public.app_user_profiles (email);
create index if not exists app_user_profiles_fluig_username_idx on public.app_user_profiles (fluig_username);
create index if not exists app_user_branch_access_branch_idx on public.app_user_branch_access (branch_id);
create index if not exists fluig_user_agents_user_status_idx on public.fluig_user_agents (user_id, status);
create index if not exists fluig_user_agents_token_hash_idx on public.fluig_user_agents (token_hash);
create index if not exists fluig_jobs_user_status_idx on public.fluig_jobs (requested_by_user_id, status, created_at desc);
create index if not exists fluig_jobs_agent_status_idx on public.fluig_jobs (assigned_agent_id, status, priority, created_at);
create index if not exists fluig_jobs_module_branch_idx on public.fluig_jobs (module_slug, branch_code, created_at desc);
create index if not exists fluig_job_events_job_created_idx on public.fluig_job_events (job_id, created_at);
create index if not exists fluig_requests_branch_code_idx on public.fluig_requests (branch_code);
create index if not exists fluig_requests_created_by_user_idx on public.fluig_requests (created_by_user_id);
create index if not exists fluig_requests_fluig_requester_login_idx on public.fluig_requests (fluig_requester_login);

alter table public.app_branches enable row level security;
alter table public.app_user_profiles enable row level security;
alter table public.app_user_branch_access enable row level security;
alter table public.fluig_user_agents enable row level security;
alter table public.fluig_jobs enable row level security;
alter table public.fluig_job_events enable row level security;

drop policy if exists "authenticated_read_app_branches" on public.app_branches;
create policy "authenticated_read_app_branches"
  on public.app_branches for select
  to authenticated
  using (true);

drop policy if exists "authenticated_read_app_user_profiles" on public.app_user_profiles;
create policy "authenticated_read_app_user_profiles"
  on public.app_user_profiles for select
  to authenticated
  using (true);

drop policy if exists "authenticated_read_app_user_branch_access" on public.app_user_branch_access;
create policy "authenticated_read_app_user_branch_access"
  on public.app_user_branch_access for select
  to authenticated
  using (true);

grant usage on schema public to authenticated;
grant select on public.app_branches to authenticated;
grant select on public.app_user_profiles to authenticated;
grant select on public.app_user_branch_access to authenticated;
revoke insert, update, delete on public.app_branches from authenticated;
revoke insert, update, delete on public.app_user_profiles from authenticated;
revoke insert, update, delete on public.app_user_branch_access from authenticated;
revoke all on public.fluig_user_agents from authenticated;
revoke all on public.fluig_jobs from authenticated;
revoke all on public.fluig_job_events from authenticated;
