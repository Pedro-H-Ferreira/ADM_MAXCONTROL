alter table public.fluig_requests
  add column if not exists expense_nature text;

update public.fluig_requests
set expense_nature = nullif(trim(coalesce(
  raw_payload->'formFields'->>'codigonaturezaC',
  raw_payload->'formFields'->>'naturezaSalva',
  raw_payload->'formFields'->>'natureza',
  raw_payload->'formFields'->>'codNatureza'
)), '')
where expense_nature is null
  and raw_payload ? 'formFields';

create index if not exists fluig_requests_open_expense_nature_idx
  on public.fluig_requests (expense_nature, module_slug, last_status_check_at desc)
  where is_open = true and expense_nature is not null;

create table if not exists public.fluig_request_user_memberships (
  request_id uuid not null references public.fluig_requests(id) on delete cascade,
  fluig_user_id text not null,
  membership_type text not null check (membership_type in ('open_task', 'my_request')),
  synced_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (request_id, fluig_user_id, membership_type)
);

alter table public.fluig_request_user_memberships enable row level security;

drop trigger if exists set_fluig_request_user_memberships_updated_at
  on public.fluig_request_user_memberships;
create trigger set_fluig_request_user_memberships_updated_at
  before update on public.fluig_request_user_memberships
  for each row execute function public.set_updated_at();

create index if not exists fluig_request_user_memberships_user_type_seen_idx
  on public.fluig_request_user_memberships (fluig_user_id, membership_type, last_seen_at desc);

create index if not exists fluig_request_user_memberships_sync_user_idx
  on public.fluig_request_user_memberships (synced_by_user_id, membership_type, last_seen_at desc)
  where synced_by_user_id is not null;

insert into public.fluig_request_user_memberships (
  request_id,
  fluig_user_id,
  membership_type,
  synced_by_user_id,
  last_seen_at
)
select
  request.id,
  request.open_task_fluig_user_id,
  'open_task',
  request.sync_owner_user_id,
  coalesce(request.last_seen_in_user_task_list_at, request.last_synced_at, now())
from public.fluig_requests request
where request.open_task_fluig_user_id is not null
on conflict (request_id, fluig_user_id, membership_type) do update
set
  synced_by_user_id = coalesce(excluded.synced_by_user_id, public.fluig_request_user_memberships.synced_by_user_id),
  last_seen_at = greatest(public.fluig_request_user_memberships.last_seen_at, excluded.last_seen_at),
  updated_at = now();

insert into public.fluig_request_user_memberships (
  request_id,
  fluig_user_id,
  membership_type,
  synced_by_user_id,
  last_seen_at
)
select
  request.id,
  request.my_request_fluig_user_id,
  'my_request',
  request.sync_owner_user_id,
  coalesce(request.last_seen_in_user_request_list_at, request.last_synced_at, now())
from public.fluig_requests request
where request.my_request_fluig_user_id is not null
on conflict (request_id, fluig_user_id, membership_type) do update
set
  synced_by_user_id = coalesce(excluded.synced_by_user_id, public.fluig_request_user_memberships.synced_by_user_id),
  last_seen_at = greatest(public.fluig_request_user_memberships.last_seen_at, excluded.last_seen_at),
  updated_at = now();

revoke all on table public.fluig_request_user_memberships from public, anon, authenticated;
grant select, insert, update, delete on table public.fluig_request_user_memberships to service_role;

comment on table public.fluig_request_user_memberships is
  'Associacao muitos-para-muitos entre solicitacoes e usuarios retornados pela Central de Tarefas do Fluig.';

comment on column public.fluig_requests.expense_nature is
  'Natureza de despesa normalizada para filtros operacionais sem varrer o JSON do formulario.';
