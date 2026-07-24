alter table public.fluig_requests
  add column if not exists detail_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists detail_synced_at timestamptz,
  add column if not exists detail_movement_sequence integer,
  add column if not exists detail_config_hash text,
  add column if not exists detail_sync_error text;

create table if not exists public.fluig_field_settings (
  id uuid primary key default gen_random_uuid(),
  module_slug text not null check (module_slug in ('pagamentos', 'compras', 'manutencao', 'fornecedores')),
  field_key text not null check (length(btrim(field_key)) between 1 and 120),
  label text not null check (length(btrim(label)) between 1 and 160),
  source_type text not null default 'form' check (source_type in ('request', 'form')),
  active boolean not null default true,
  visible_in_list boolean not null default false,
  list_order integer,
  visible_in_form boolean not null default true,
  form_order integer,
  updated_by_user_id uuid references public.app_user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fluig_field_settings_module_field_unique unique (module_slug, field_key),
  constraint fluig_field_settings_active_visibility_check check (
    active or (visible_in_list = false and visible_in_form = false)
  )
);

alter table public.fluig_field_settings enable row level security;

drop trigger if exists set_fluig_field_settings_updated_at on public.fluig_field_settings;
create trigger set_fluig_field_settings_updated_at
  before update on public.fluig_field_settings
  for each row execute function public.set_updated_at();

create index if not exists fluig_field_settings_module_list_idx
  on public.fluig_field_settings (module_slug, visible_in_list desc, list_order, label);

create index if not exists fluig_field_settings_module_form_idx
  on public.fluig_field_settings (module_slug, visible_in_form desc, form_order, label);

revoke all on table public.fluig_field_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.fluig_field_settings to service_role;

drop policy if exists "authenticated_read_fluig_field_settings" on public.fluig_field_settings;
create policy "authenticated_read_fluig_field_settings"
  on public.fluig_field_settings for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
    )
  );

drop policy if exists "admins_manage_fluig_field_settings" on public.fluig_field_settings;
create policy "admins_manage_fluig_field_settings"
  on public.fluig_field_settings for all
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
        and profile.role in ('ADMIN_MASTER', 'ADMIN')
    )
  )
  with check (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
        and profile.role in ('ADMIN_MASTER', 'ADMIN')
    )
  );

insert into public.fluig_field_settings (
  module_slug,
  field_key,
  label,
  source_type,
  active,
  visible_in_list,
  list_order,
  visible_in_form,
  form_order
)
select module_slug, field_key, label, source_type, true, visible_in_list, list_order, visible_in_form, form_order
from (
  values
    ('pagamentos', 'fluigRequestId', 'Fluig', 'request', true, 10, false, null),
    ('pagamentos', 'nNotaFiscal', 'Numero da NF', 'form', true, 20, true, 10),
    ('pagamentos', 'supplierName', 'Fornecedor / filial', 'request', true, 30, false, null),
    ('pagamentos', 'valorNF', 'Valor da NF', 'form', true, 40, true, 20),
    ('pagamentos', 'vencPagNota', 'Vencimento', 'form', true, 50, true, 30),
    ('pagamentos', 'codigonaturezaC', 'Natureza de despesa', 'form', true, 60, true, 40),
    ('pagamentos', 'currentTask', 'Etapa / responsavel', 'request', true, 70, false, null),
    ('pagamentos', 'status', 'Status', 'request', true, 80, false, null),
    ('pagamentos', 'dataEmissaoNF', 'Data de emissao', 'form', false, null, true, 50),
    ('pagamentos', 'fornecedorC', 'Fornecedor', 'form', false, null, true, 60),
    ('pagamentos', 'codCNPJ', 'CNPJ', 'form', false, null, true, 70),
    ('pagamentos', 'unidadeFilial', 'Filial', 'form', false, null, true, 80),
    ('pagamentos', 'centroCusto', 'Centro de custo', 'form', false, null, true, 90),
    ('pagamentos', 'formaPagamento', 'Forma de pagamento', 'form', false, null, true, 100),
    ('pagamentos', 'descricaoDemandaEnvio', 'Descricao da demanda', 'form', false, null, true, 110),
    ('compras', 'fluigRequestId', 'Fluig', 'request', true, 10, false, null),
    ('compras', 'supplierName', 'Fornecedor / filial', 'request', true, 20, false, null),
    ('compras', 'dueDate', 'Vencimento', 'request', true, 30, false, null),
    ('compras', 'currentTask', 'Etapa / responsavel', 'request', true, 40, false, null),
    ('compras', 'status', 'Status', 'request', true, 50, false, null),
    ('manutencao', 'fluigRequestId', 'Fluig', 'request', true, 10, false, null),
    ('manutencao', 'supplierName', 'Fornecedor / filial', 'request', true, 20, false, null),
    ('manutencao', 'dueDate', 'Vencimento', 'request', true, 30, false, null),
    ('manutencao', 'currentTask', 'Etapa / responsavel', 'request', true, 40, false, null),
    ('manutencao', 'status', 'Status', 'request', true, 50, false, null)
) as defaults(module_slug, field_key, label, source_type, visible_in_list, list_order, visible_in_form, form_order)
on conflict (module_slug, field_key) do nothing;

comment on table public.fluig_field_settings is
  'Campos ativos e ordem de exibicao do Fluig por modulo; a configuracao tambem limita os campos persistidos nos snapshots.';
comment on column public.fluig_requests.detail_snapshot is
  'Formulario filtrado, historico e metadados de anexos gravados durante a sincronizacao Fluig.';
