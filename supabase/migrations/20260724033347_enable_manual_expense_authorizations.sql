begin;

alter table public.app_expense_authorizations
  alter column launch_id drop not null;

alter table public.app_expense_authorizations
  add column if not exists creation_source text not null default 'LANCAMENTO',
  add column if not exists invoice_number text,
  add column if not exists invoice_due_date date;

alter table public.app_expense_authorizations
  drop constraint if exists app_expense_authorizations_creation_source_check;

alter table public.app_expense_authorizations
  add constraint app_expense_authorizations_creation_source_check
  check (creation_source in ('LANCAMENTO', 'MANUAL', 'DOCUMENTO_FISCAL'));

comment on column public.app_expense_authorizations.launch_id is
  'Lancamento operacional de origem; nulo quando a ADF foi criada diretamente no controle de ADF.';
comment on column public.app_expense_authorizations.creation_source is
  'Origem da criacao: lancamento operacional, preenchimento manual ou leitura de documento fiscal.';
comment on column public.app_expense_authorizations.invoice_number is
  'Numero da nota fiscal informada manualmente ou lida do PDF/XML.';
comment on column public.app_expense_authorizations.invoice_due_date is
  'Vencimento da nota fiscal informada manualmente ou lida do PDF/XML.';

commit;
