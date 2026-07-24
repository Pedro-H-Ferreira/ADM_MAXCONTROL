create table if not exists public.fluig_monitored_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and email <> ''),
  display_name text not null check (btrim(display_name) <> ''),
  fluig_user_id text,
  fluig_login text,
  app_user_id uuid references public.app_user_profiles(id) on delete set null,
  active boolean not null default true,
  source text not null default 'admin_list',
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  task_count integer not null default 0 check (task_count >= 0),
  request_count integer not null default 0 check (request_count >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fluig_monitored_users_fluig_user_id_uidx
  on public.fluig_monitored_users (fluig_user_id)
  where nullif(btrim(fluig_user_id), '') is not null;

create index if not exists fluig_monitored_users_active_name_idx
  on public.fluig_monitored_users (active, display_name);

drop trigger if exists set_fluig_monitored_users_updated_at on public.fluig_monitored_users;
create trigger set_fluig_monitored_users_updated_at
  before update on public.fluig_monitored_users
  for each row execute function public.set_updated_at();

alter table public.fluig_monitored_users enable row level security;
revoke all on table public.fluig_monitored_users from public, anon, authenticated;
grant select, insert, update, delete on table public.fluig_monitored_users to service_role;

insert into public.fluig_monitored_users (display_name, email, source)
values
  ('Administrativo Atacadao Dia a Dia - AGC', 'administrativo.agc@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia Aguas Lindas', 'administrativo.agl@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Atacadao Dia a Dia - APS', 'administrativo.aps@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia Goiania Balneario', 'administrativo.gynbal@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia BR070', 'administrativo.br070@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia Caldas Novas', 'administrativo.cdn@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Ceilandia Centro', 'administrativo.qnm11@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia QNN30', 'administrativo.qnn30@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia Goiania Novo Horizonte', 'administrativo.gynnov@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia - EPTG', 'administrativo.eptg@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Formosa - Atacadao Dia a Dia', 'administrativo.fsa@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Gama', 'administrativo.gama@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Atacadao Dia a Dia Goianesia', 'administrativo.gon@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Guara', 'administrativo.guara@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Atacadao Dia a Dia - GRP', 'administrativo.grp@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Itumbiara - Atacadao Dia a Dia', 'administrativo.itb@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Atacadao Dia a Dia - SMDB', 'administrativo.smdb@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo LEM', 'administrativo.lem@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia Luziania', 'administrativo.luz@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Luziania 2 - Atacadao Dia a Dia', 'administrativo.luz2@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Mestre D''armas', 'administrativo.mda@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Novo Gama', 'administrativo.novogama@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Planaltina DF Atacadao Dia a Dia', 'administrativo.pdf@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia - Planaltina GO', 'administrativo.pgo@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia - Recanto das Emas', 'administrativo.rde@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Riacho Fundo 1 - Atacadao Dia a Dia', 'administrativo.rfo1@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia - Rio Verde GO', 'administrativo.rvd@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia - Samambaia Furnas', 'administrativo.smb2@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia - Samambaia', 'administrativo.smb@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia - Samambaia Furnas 060', 'administrativo.smb060@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia Santo Antonio', 'administrativo.sad@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia SIA', 'administrativo.sia@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia Sobradinho', 'administrativo.sob@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Dia a Dia Taguatinga', 'administrativo.tag@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Atacadao Dia a Dia de Vicente Pires', 'administrativo.vcp@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo Atacadao Dia a Dia - Vicente Pires - Rua 04', 'administrativo.vcp2@atacadaodiaadia.com.br', 'admin_list'),
  ('Administrativo QNN09 - Atacadao Dia a Dia', 'administrativo.qnn09@atacadaodiaadia.com.br', 'admin_list')
on conflict (email) do update set
  display_name = excluded.display_name,
  active = true,
  source = excluded.source,
  updated_at = now();
