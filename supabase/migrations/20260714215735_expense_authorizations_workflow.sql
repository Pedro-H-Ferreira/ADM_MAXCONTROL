begin;

create sequence if not exists public.app_expense_authorization_number_seq;

create or replace function public.next_expense_authorization_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'ADF-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.app_expense_authorization_number_seq')::text, 6, '0');
$$;

create table if not exists public.app_expense_authorizations (
  id uuid primary key default gen_random_uuid(),
  document_number text not null unique default public.next_expense_authorization_number(),
  launch_id uuid not null unique references public.app_fluig_launches(id) on delete restrict,
  module_slug text not null check (module_slug in ('pagamentos', 'compras')),
  status text not null default 'EM_ELABORACAO' check (
    status in (
      'EM_ELABORACAO',
      'AGUARDANDO_ASSINATURA',
      'ASSINADA',
      'ENTREGUE',
      'ANEXO_NA_FILA',
      'ANEXADA_FLUIG',
      'CANCELADA'
    )
  ),
  issue_date date not null default current_date,
  expense_type text,
  description text not null,
  expense_account text,
  financial_account text,
  cost_center text,
  branch_id uuid references public.app_branches(id) on delete set null,
  branch_code text,
  branch_label text,
  supplier_name text,
  supplier_tax_id text,
  amount_cents bigint,
  amount_words text,
  beneficiary_category text,
  beneficiary_name text,
  beneficiary_tax_id text,
  beneficiary_phone text,
  payment_method text,
  bank_name text,
  bank_operation text,
  bank_agency text,
  bank_account text,
  pix_key text,
  requester_name text,
  requester_role text,
  budget_planned_cents bigint,
  budget_realized_cents bigint,
  budget_deviation_cents bigint,
  budget_deviation_percent numeric(9, 2),
  additional_info text,
  fluig_request_id text,
  physical_location text,
  delivered_to text,
  signature_storage_bucket text,
  signature_storage_path text,
  signature_file_name text,
  signature_mime_type text,
  signature_size_bytes bigint,
  signature_received_at timestamptz,
  sent_for_signature_at timestamptz,
  delivered_at timestamptz,
  attached_to_fluig_at timestamptz,
  attach_job_id uuid references public.fluig_jobs(id) on delete set null,
  source_snapshot jsonb not null default '{}'::jsonb,
  last_error_message text,
  created_by_user_id uuid not null references public.app_user_profiles(id) on delete restrict,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (amount_cents is null or amount_cents >= 0),
  check (budget_planned_cents is null or budget_planned_cents >= 0),
  check (budget_realized_cents is null or budget_realized_cents >= 0),
  check (signature_size_bytes is null or signature_size_bytes >= 0)
);

create table if not exists public.app_expense_authorization_events (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references public.app_expense_authorizations(id) on delete cascade,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  event_type text not null,
  label text not null,
  status_from text,
  status_to text,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_expense_authorizations_status_idx
  on public.app_expense_authorizations (status, updated_at desc)
  where deleted_at is null;
create index if not exists app_expense_authorizations_fluig_idx
  on public.app_expense_authorizations (fluig_request_id)
  where fluig_request_id is not null and deleted_at is null;
create index if not exists app_expense_authorizations_branch_idx
  on public.app_expense_authorizations (branch_id, updated_at desc)
  where deleted_at is null;
create index if not exists app_expense_authorization_events_timeline_idx
  on public.app_expense_authorization_events (authorization_id, created_at desc);

drop trigger if exists set_app_expense_authorizations_updated_at on public.app_expense_authorizations;
create trigger set_app_expense_authorizations_updated_at
  before update on public.app_expense_authorizations
  for each row execute function public.set_updated_at();

create or replace function public.ensure_expense_authorization_for_launch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester_name text;
  v_requester_role text;
  v_authorization_id uuid;
begin
  if new.module_slug not in ('pagamentos', 'compras') or new.deleted_at is not null then
    return new;
  end if;

  select profile.display_name, profile.role
    into v_requester_name, v_requester_role
  from public.app_user_profiles profile
  where profile.id = new.created_by_user_id;

  insert into public.app_expense_authorizations (
    launch_id,
    module_slug,
    description,
    expense_type,
    expense_account,
    financial_account,
    cost_center,
    branch_id,
    branch_code,
    branch_label,
    supplier_name,
    supplier_tax_id,
    amount_cents,
    beneficiary_category,
    beneficiary_name,
    beneficiary_tax_id,
    payment_method,
    requester_name,
    requester_role,
    fluig_request_id,
    source_snapshot,
    created_by_user_id,
    updated_by_user_id
  ) values (
    new.id,
    new.module_slug,
    coalesce(nullif(new.description, ''), new.title),
    case when new.module_slug = 'compras' then 'AQUISICAO_DE_BENS_E_SERVICOS' else 'OUTROS' end,
    coalesce(nullif(new.field_overrides ->> 'contaCentroCusto', ''), nullif(new.field_overrides ->> 'codigonaturezaC', '')),
    coalesce(nullif(new.field_overrides ->> 'codigonaturezaC', ''), nullif(new.field_overrides ->> 'contaCentroCusto', '')),
    nullif(new.field_overrides ->> 'centroCusto', ''),
    new.branch_id,
    new.branch_code,
    new.branch_label,
    new.supplier_name,
    new.supplier_cnpj,
    new.amount_cents,
    case when new.supplier_name is not null then 'EMPRESA' else null end,
    new.supplier_name,
    new.supplier_cnpj,
    nullif(new.field_overrides ->> 'formaPagamento', ''),
    v_requester_name,
    v_requester_role,
    new.fluig_request_id,
    jsonb_build_object(
      'launchTitle', new.title,
      'sourceRequestId', new.source_request_id,
      'fieldOverrides', new.field_overrides,
      'itemsCapturedAt', now()
    ),
    new.created_by_user_id,
    new.updated_by_user_id
  )
  on conflict (launch_id) do update
  set fluig_request_id = coalesce(excluded.fluig_request_id, public.app_expense_authorizations.fluig_request_id),
      branch_id = excluded.branch_id,
      branch_code = excluded.branch_code,
      branch_label = excluded.branch_label,
      supplier_name = excluded.supplier_name,
      supplier_tax_id = excluded.supplier_tax_id,
      amount_cents = excluded.amount_cents,
      updated_by_user_id = excluded.updated_by_user_id
  returning id into v_authorization_id;

  if tg_op = 'INSERT' then
    insert into public.app_expense_authorization_events (
      authorization_id, actor_user_id, event_type, label, status_to, event_payload
    ) values (
      v_authorization_id,
      new.created_by_user_id,
      'CREATED_FROM_LAUNCH',
      'ADF criada automaticamente a partir do lancamento operacional.',
      'EM_ELABORACAO',
      jsonb_build_object('launchId', new.id, 'module', new.module_slug)
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_expense_authorization_after_launch on public.app_fluig_launches;
create trigger ensure_expense_authorization_after_launch
  after insert or update of fluig_request_id, branch_id, branch_code, branch_label, supplier_name, supplier_cnpj, amount_cents
  on public.app_fluig_launches
  for each row execute function public.ensure_expense_authorization_for_launch();

insert into public.app_expense_authorizations (
  launch_id,
  module_slug,
  description,
  expense_type,
  expense_account,
  financial_account,
  cost_center,
  branch_id,
  branch_code,
  branch_label,
  supplier_name,
  supplier_tax_id,
  amount_cents,
  beneficiary_category,
  beneficiary_name,
  beneficiary_tax_id,
  payment_method,
  requester_name,
  requester_role,
  fluig_request_id,
  source_snapshot,
  created_by_user_id,
  updated_by_user_id
)
select
  launch.id,
  launch.module_slug,
  coalesce(nullif(launch.description, ''), launch.title),
  case when launch.module_slug = 'compras' then 'AQUISICAO_DE_BENS_E_SERVICOS' else 'OUTROS' end,
  coalesce(nullif(launch.field_overrides ->> 'contaCentroCusto', ''), nullif(launch.field_overrides ->> 'codigonaturezaC', '')),
  coalesce(nullif(launch.field_overrides ->> 'codigonaturezaC', ''), nullif(launch.field_overrides ->> 'contaCentroCusto', '')),
  nullif(launch.field_overrides ->> 'centroCusto', ''),
  launch.branch_id,
  launch.branch_code,
  launch.branch_label,
  launch.supplier_name,
  launch.supplier_cnpj,
  launch.amount_cents,
  case when launch.supplier_name is not null then 'EMPRESA' else null end,
  launch.supplier_name,
  launch.supplier_cnpj,
  nullif(launch.field_overrides ->> 'formaPagamento', ''),
  profile.display_name,
  profile.role,
  launch.fluig_request_id,
  jsonb_build_object(
    'launchTitle', launch.title,
    'sourceRequestId', launch.source_request_id,
    'fieldOverrides', launch.field_overrides,
    'backfilledAt', now()
  ),
  launch.created_by_user_id,
  launch.updated_by_user_id
from public.app_fluig_launches launch
join public.app_user_profiles profile on profile.id = launch.created_by_user_id
where launch.module_slug in ('pagamentos', 'compras')
  and launch.deleted_at is null
on conflict (launch_id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('adf-documents', 'adf-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.fluig_jobs
  drop constraint if exists fluig_jobs_operation_check;

alter table public.fluig_jobs
  add constraint fluig_jobs_operation_check
  check (
    operation in (
      'sync_history',
      'sync_status',
      'open_from_source',
      'attach_to_request',
      'cancel_request',
      'health_check',
      'sync_initial_history',
      'sync_user_open_tasks',
      'sync_user_open_requests',
      'sync_user_incremental_batch',
      'sync_request_by_number',
      'supplier_lookup_by_cnpj'
    )
  );

insert into public.app_user_page_access (
  user_id, page_slug, can_view, can_create, can_update, can_approve
)
select
  access.user_id,
  'adfs',
  true,
  bool_or(access.can_create),
  bool_or(access.can_update),
  bool_or(access.can_approve)
from public.app_user_page_access access
where access.page_slug in ('pagamentos', 'compras', 'cotacoes')
  and access.can_view is true
group by access.user_id
on conflict (user_id, page_slug) do update
set can_view = true,
    can_create = excluded.can_create,
    can_update = excluded.can_update,
    can_approve = excluded.can_approve,
    updated_at = now();

do $$
declare
  v_definition text;
begin
  if to_regprocedure('public.save_app_user_access(uuid,jsonb)') is not null then
    select pg_get_functiondef('public.save_app_user_access(uuid,jsonb)'::regprocedure)
      into v_definition;
    v_definition := replace(
      v_definition,
      '''dashboard'', ''despesas'', ''pagamentos'', ''contratos''',
      '''dashboard'', ''despesas'', ''pagamentos'', ''adfs'', ''contratos'''
    );
    execute v_definition;
  end if;
end;
$$;

alter table public.app_expense_authorizations enable row level security;
alter table public.app_expense_authorization_events enable row level security;

drop policy if exists "service_role_manage_expense_authorizations" on public.app_expense_authorizations;
create policy "service_role_manage_expense_authorizations"
  on public.app_expense_authorizations
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_manage_expense_authorization_events" on public.app_expense_authorization_events;
create policy "service_role_manage_expense_authorization_events"
  on public.app_expense_authorization_events
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.app_expense_authorizations from public, anon, authenticated;
revoke all on table public.app_expense_authorization_events from public, anon, authenticated;
revoke all on sequence public.app_expense_authorization_number_seq from public, anon, authenticated;
revoke execute on function public.next_expense_authorization_number() from public, anon, authenticated;
revoke execute on function public.ensure_expense_authorization_for_launch() from public, anon, authenticated;

grant select, insert, update, delete on table public.app_expense_authorizations to service_role;
grant select, insert, update, delete on table public.app_expense_authorization_events to service_role;
grant usage, select on sequence public.app_expense_authorization_number_seq to service_role;
grant execute on function public.next_expense_authorization_number() to service_role;
grant execute on function public.ensure_expense_authorization_for_launch() to service_role;

commit;
