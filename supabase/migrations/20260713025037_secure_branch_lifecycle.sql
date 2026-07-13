alter table public.app_branches
  add column if not exists code_normalized text generated always as (upper(btrim(code))) stored;

alter table public.app_branches
  drop constraint if exists app_branches_code_not_blank,
  drop constraint if exists app_branches_name_not_blank,
  drop constraint if exists app_branches_uf_format;

alter table public.app_branches
  add constraint app_branches_code_not_blank check (btrim(code) <> ''),
  add constraint app_branches_name_not_blank check (btrim(name) <> ''),
  add constraint app_branches_uf_format check (uf is null or uf ~ '^[A-Z]{2}$'),
  add constraint app_branches_deleted_state check (deleted_at is null or active is false);

alter table public.app_user_branch_access
  drop constraint if exists app_user_branch_access_create_requires_view;

alter table public.app_user_branch_access
  add constraint app_user_branch_access_create_requires_view check (not can_create or can_view);

create unique index if not exists app_branches_code_normalized_unique
  on public.app_branches (code_normalized);

create unique index if not exists app_user_branch_access_one_home_per_user
  on public.app_user_branch_access (user_id)
  where is_home is true;

create table if not exists public.app_branch_audit_events (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.app_branches(id) on delete set null,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  event_type text not null check (event_type in ('CREATED', 'UPDATED', 'INACTIVATED', 'REACTIVATED', 'DELETED')),
  before_payload jsonb,
  after_payload jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_branch_audit_events_branch_created_idx
  on public.app_branch_audit_events (branch_id, created_at desc);

alter table public.app_user_page_access
  drop constraint if exists app_user_page_access_actions_require_view;

alter table public.app_user_page_access
  add constraint app_user_page_access_actions_require_view
  check (can_view or (not can_create and not can_update and not can_approve));

create table if not exists public.app_user_access_audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_user_profiles(id) on delete set null,
  actor_user_id uuid references public.app_user_profiles(id) on delete set null,
  event_type text not null check (event_type in ('CREATED', 'UPDATED', 'APPROVED', 'BLOCKED', 'ACCESS_CHANGED')),
  before_payload jsonb,
  after_payload jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_user_access_audit_user_created_idx
  on public.app_user_access_audit_events (user_id, created_at desc);

create or replace function public.normalize_app_branch()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.code := upper(btrim(new.code));
  new.name := btrim(new.name);
  new.fluig_label := nullif(btrim(new.fluig_label), '');
  new.region := nullif(btrim(new.region), '');
  new.city := nullif(btrim(new.city), '');
  new.uf := nullif(upper(btrim(new.uf)), '');
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists normalize_app_branch_before_write on public.app_branches;
create trigger normalize_app_branch_before_write
  before insert or update on public.app_branches
  for each row execute function public.normalize_app_branch();

update public.app_branches branch
set last_fluig_sync_at = summary.last_sync_at
from (
  select
    matched.id as branch_id,
    max(coalesce(request.last_synced_at, request.updated_at, request.created_at)) as last_sync_at
  from public.fluig_requests request
  join public.app_branches matched
    on matched.id = request.branch_id
    or (request.branch_id is null and matched.code = request.branch_code)
  group by matched.id
) summary
where branch.id = summary.branch_id
  and branch.last_fluig_sync_at is distinct from summary.last_sync_at;

create or replace function public.touch_branch_fluig_sync()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.app_branches branch
  set last_fluig_sync_at = greatest(
    coalesce(branch.last_fluig_sync_at, '-infinity'::timestamptz),
    coalesce(new.last_synced_at, new.updated_at, new.created_at, now())
  )
  where branch.id = new.branch_id
     or (new.branch_id is null and branch.code = new.branch_code);
  return new;
end;
$$;

drop trigger if exists touch_branch_fluig_sync_after_request on public.fluig_requests;
create trigger touch_branch_fluig_sync_after_request
  after insert or update of branch_id, branch_code, last_synced_at on public.fluig_requests
  for each row execute function public.touch_branch_fluig_sync();

create or replace function public.save_app_branch(
  p_actor_user_id uuid,
  p_branch_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor public.app_user_profiles%rowtype;
  current_branch public.app_branches%rowtype;
  saved_branch public.app_branches%rowtype;
  required_action text := case when p_branch_id is null then 'can_create' else 'can_update' end;
  is_admin boolean := false;
  allowed boolean := false;
  next_code text;
  next_name text;
  next_active boolean;
  has_code_links boolean := false;
  event_name text;
begin
  select * into actor
  from public.app_user_profiles
  where id = p_actor_user_id
    and active is true
    and approval_status = 'APPROVED';

  if actor.id is null then
    raise exception using message = 'BRANCH_FORBIDDEN';
  end if;

  is_admin := actor.role in ('ADMIN_MASTER', 'ADMIN');

  if is_admin then
    allowed := true;
  else
    select exists (
      select 1
      from public.app_user_page_access access
      where access.user_id = actor.id
        and access.page_slug = 'configuracoes'
        and access.can_view is true
        and case required_action
          when 'can_create' then access.can_create
          else access.can_update
        end is true
    ) into allowed;
  end if;

  if not allowed then
    raise exception using message = 'BRANCH_FORBIDDEN';
  end if;

  if p_branch_id is not null then
    select * into current_branch
    from public.app_branches
    where id = p_branch_id
    for update;

    if current_branch.id is null then
      raise exception using message = 'BRANCH_NOT_FOUND';
    end if;

    if not is_admin and not exists (
      select 1
      from public.app_user_branch_access access
      where access.user_id = actor.id
        and access.branch_id = current_branch.id
        and access.can_view is true
    ) then
      raise exception using message = 'BRANCH_FORBIDDEN';
    end if;
  end if;

  next_code := upper(btrim(coalesce(nullif(p_payload->>'code', ''), current_branch.code)));
  next_name := btrim(coalesce(nullif(p_payload->>'name', ''), current_branch.name));
  next_active := coalesce((p_payload->>'active')::boolean, current_branch.active, true);

  if coalesce(next_code, '') = '' then
    raise exception using message = 'BRANCH_CODE_REQUIRED';
  end if;
  if coalesce(next_name, '') = '' then
    raise exception using message = 'BRANCH_NAME_REQUIRED';
  end if;

  if p_branch_id is not null and next_code <> current_branch.code then
    select
      exists(select 1 from public.app_user_branch_access where branch_id = p_branch_id)
      or exists(select 1 from public.app_user_profiles where home_branch_id = p_branch_id)
      or exists(select 1 from public.app_supplier_branch_links where branch_id = p_branch_id)
      or exists(select 1 from public.fluig_requests where branch_id = p_branch_id)
      or exists(select 1 from public.fluig_requests where branch_id is null and branch_code = current_branch.code)
      or exists(select 1 from public.fluig_jobs where branch_id = p_branch_id)
      or exists(select 1 from public.fluig_jobs where branch_id is null and branch_code = current_branch.code)
      or exists(select 1 from public.app_fluig_launches where branch_id = p_branch_id)
      or exists(select 1 from public.app_fluig_launches where branch_id is null and branch_code = current_branch.code)
      or exists(select 1 from public.app_maintenance_orders where branch_id = p_branch_id)
      or exists(select 1 from public.app_maintenance_orders where branch_id is null and branch_code = current_branch.code)
    into has_code_links;

    if has_code_links then
      raise exception using message = 'BRANCH_CODE_LOCKED';
    end if;
  end if;

  if exists (
    select 1
    from public.app_branches branch
    where branch.code_normalized = next_code
      and branch.id is distinct from p_branch_id
  ) then
    raise exception using message = 'BRANCH_CODE_CONFLICT';
  end if;

  if p_branch_id is null then
    insert into public.app_branches (
      code, name, fluig_label, region, city, uf, active, metadata
    ) values (
      next_code,
      next_name,
      nullif(btrim(p_payload->>'fluigLabel'), ''),
      nullif(btrim(p_payload->>'region'), ''),
      nullif(btrim(p_payload->>'city'), ''),
      nullif(upper(btrim(p_payload->>'uf')), ''),
      next_active,
      coalesce(p_payload->'metadata', '{}'::jsonb)
    ) returning * into saved_branch;

    if not is_admin then
      insert into public.app_user_branch_access (user_id, branch_id, can_view, can_create, is_home)
      values (
        actor.id,
        saved_branch.id,
        true,
        true,
        actor.home_branch_id is null
      )
      on conflict (user_id, branch_id) do update
      set can_view = true,
          can_create = true;

      if actor.home_branch_id is null then
        update public.app_user_profiles
        set home_branch_id = saved_branch.id,
            updated_at = now()
        where id = actor.id;
      end if;
    end if;

    event_name := 'CREATED';
  else
    update public.app_branches
    set code = next_code,
        name = next_name,
        fluig_label = case when p_payload ? 'fluigLabel' then nullif(btrim(p_payload->>'fluigLabel'), '') else fluig_label end,
        region = case when p_payload ? 'region' then nullif(btrim(p_payload->>'region'), '') else region end,
        city = case when p_payload ? 'city' then nullif(btrim(p_payload->>'city'), '') else city end,
        uf = case when p_payload ? 'uf' then nullif(upper(btrim(p_payload->>'uf')), '') else uf end,
        active = next_active,
        deleted_at = case when next_active then null else deleted_at end,
        metadata = case when p_payload ? 'metadata' then coalesce(p_payload->'metadata', '{}'::jsonb) else metadata end
    where id = p_branch_id
    returning * into saved_branch;

    event_name := case
      when current_branch.active is false and saved_branch.active is true then 'REACTIVATED'
      when current_branch.active is true and saved_branch.active is false then 'INACTIVATED'
      else 'UPDATED'
    end;
  end if;

  insert into public.app_branch_audit_events (
    branch_id, actor_user_id, event_type, before_payload, after_payload
  ) values (
    saved_branch.id,
    actor.id,
    event_name,
    case when current_branch.id is null then null else to_jsonb(current_branch) end,
    to_jsonb(saved_branch)
  );

  return to_jsonb(saved_branch);
end;
$$;

create or replace function public.delete_app_branch(
  p_actor_user_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor public.app_user_profiles%rowtype;
  current_branch public.app_branches%rowtype;
  is_admin boolean := false;
  allowed boolean := false;
  relation_count bigint := 0;
  soft_deleted boolean := false;
begin
  select * into actor
  from public.app_user_profiles
  where id = p_actor_user_id
    and active is true
    and approval_status = 'APPROVED';

  if actor.id is null then
    raise exception using message = 'BRANCH_FORBIDDEN';
  end if;

  is_admin := actor.role in ('ADMIN_MASTER', 'ADMIN');
  if is_admin then
    allowed := true;
  else
    select exists (
      select 1
      from public.app_user_page_access page_access
      join public.app_user_branch_access branch_access
        on branch_access.user_id = page_access.user_id
       and branch_access.branch_id = p_branch_id
       and branch_access.can_view is true
      where page_access.user_id = actor.id
        and page_access.page_slug = 'configuracoes'
        and page_access.can_view is true
        and page_access.can_update is true
    ) into allowed;
  end if;

  if not allowed then
    raise exception using message = 'BRANCH_FORBIDDEN';
  end if;

  select * into current_branch
  from public.app_branches
  where id = p_branch_id
  for update;

  if current_branch.id is null then
    raise exception using message = 'BRANCH_NOT_FOUND';
  end if;

  select
    (select count(*) from public.app_user_branch_access where branch_id = p_branch_id)
    + (select count(*) from public.app_user_profiles where home_branch_id = p_branch_id)
    + (select count(*) from public.app_supplier_branch_links where branch_id = p_branch_id)
    + (select count(*) from public.fluig_requests where branch_id = p_branch_id)
    + (select count(*) from public.fluig_requests where branch_id is null and branch_code = current_branch.code)
    + (select count(*) from public.fluig_jobs where branch_id = p_branch_id)
    + (select count(*) from public.fluig_jobs where branch_id is null and branch_code = current_branch.code)
    + (select count(*) from public.app_fluig_launches where branch_id = p_branch_id)
    + (select count(*) from public.app_fluig_launches where branch_id is null and branch_code = current_branch.code)
    + (select count(*) from public.app_maintenance_orders where branch_id = p_branch_id)
    + (select count(*) from public.app_maintenance_orders where branch_id is null and branch_code = current_branch.code)
  into relation_count;

  if relation_count > 0 then
    update public.app_branches
    set active = false,
        deleted_at = coalesce(deleted_at, now())
    where id = p_branch_id;
    soft_deleted := true;
  else
    delete from public.app_branches where id = p_branch_id;
  end if;

  insert into public.app_branch_audit_events (
    branch_id, actor_user_id, event_type, before_payload, after_payload, metadata
  ) values (
    case when soft_deleted then p_branch_id else null end,
    actor.id,
    case when soft_deleted then 'INACTIVATED' else 'DELETED' end,
    to_jsonb(current_branch),
    case when soft_deleted then jsonb_set(to_jsonb(current_branch), '{active}', 'false'::jsonb) else null end,
    jsonb_build_object('relationCount', relation_count, 'softDeleted', soft_deleted)
  );

  return jsonb_build_object(
    'deleted', not soft_deleted,
    'softDeleted', soft_deleted,
    'relationCount', relation_count
  );
end;
$$;

create or replace function public.save_app_user_access(
  p_actor_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor public.app_user_profiles%rowtype;
  current_profile public.app_user_profiles%rowtype;
  saved_profile public.app_user_profiles%rowtype;
  target_id uuid := nullif(p_payload->>'id', '')::uuid;
  target_role text;
  next_active boolean;
  next_approval text;
  next_home_branch_id uuid;
  branch_ids uuid[] := '{}'::uuid[];
  page_row jsonb;
  page_slug text;
  event_name text := 'UPDATED';
begin
  select * into actor
  from public.app_user_profiles
  where id = p_actor_id
    and active is true
    and approval_status = 'APPROVED'
    and role in ('ADMIN_MASTER', 'ADMIN');

  if actor.id is null then
    raise exception using message = 'USER_ADMIN_REQUIRED';
  end if;

  if target_id is not null then
    select * into current_profile
    from public.app_user_profiles
    where id = target_id
    for update;
    if current_profile.id is null then
      raise exception using message = 'USER_NOT_FOUND';
    end if;
  end if;

  target_role := coalesce(nullif(p_payload->>'role', ''), current_profile.role, 'LEITURA');
  next_active := coalesce((p_payload->>'active')::boolean, current_profile.active, true);
  next_approval := coalesce(nullif(p_payload->>'approval_status', ''), current_profile.approval_status, 'APPROVED');

  if actor.role <> 'ADMIN_MASTER'
     and (current_profile.role = 'ADMIN_MASTER' or target_role = 'ADMIN_MASTER') then
    raise exception using message = 'USER_ADMIN_MASTER_REQUIRED';
  end if;

  if current_profile.id = actor.id
     and (target_role not in ('ADMIN_MASTER', 'ADMIN') or not next_active or next_approval <> 'APPROVED') then
    raise exception using message = 'USER_SELF_LOCKOUT';
  end if;

  if current_profile.role = 'ADMIN_MASTER'
     and (target_role <> 'ADMIN_MASTER' or not next_active or next_approval <> 'APPROVED')
     and (
       select count(*)
       from public.app_user_profiles profile
       where profile.role = 'ADMIN_MASTER'
         and profile.active is true
         and profile.approval_status = 'APPROVED'
     ) <= 1 then
    raise exception using message = 'USER_LAST_ADMIN_MASTER';
  end if;

  if target_id is null
     and target_role not in ('ADMIN_MASTER', 'ADMIN')
     and not (p_payload ? 'branch_ids') then
    raise exception using message = 'USER_INVALID_BRANCH_MATRIX';
  end if;

  if p_payload ? 'branch_ids' or p_payload ? 'home_branch_id' then
    if not (p_payload ? 'branch_ids') or not (p_payload ? 'home_branch_id') then
      raise exception using message = 'USER_INVALID_BRANCH_MATRIX';
    end if;

    select coalesce(array_agg(value::uuid), '{}'::uuid[])
    into branch_ids
    from jsonb_array_elements_text(coalesce(p_payload->'branch_ids', '[]'::jsonb));
    next_home_branch_id := nullif(p_payload->>'home_branch_id', '')::uuid;

    if cardinality(branch_ids) <> (
      select count(distinct branch_id)
      from unnest(branch_ids) branch_id
    ) then
      raise exception using message = 'USER_INVALID_BRANCH_MATRIX';
    end if;

    if target_role in ('ADMIN_MASTER', 'ADMIN') and cardinality(branch_ids) = 0 and next_home_branch_id is null then
      null;
    elsif cardinality(branch_ids) = 0
       or next_home_branch_id is null
       or not (next_home_branch_id = any(branch_ids)) then
      raise exception using message = 'USER_INVALID_BRANCH_MATRIX';
    elsif (
      select count(*)
      from public.app_branches branch
      where branch.id = any(branch_ids)
        and branch.active is true
        and branch.deleted_at is null
    ) <> cardinality(branch_ids) then
      raise exception using message = 'USER_INVALID_BRANCH';
    end if;
  else
    next_home_branch_id := current_profile.home_branch_id;
  end if;

  if target_id is null then
    if coalesce(btrim(p_payload->>'display_name'), '') = '' then
      raise exception using message = 'USER_NAME_REQUIRED';
    end if;

    insert into public.app_user_profiles (
      email,
      display_name,
      role,
      fluig_username,
      fluig_user_id,
      home_branch_id,
      active,
      approval_status,
      approved_at,
      approved_by_user_id,
      rejected_at,
      rejection_reason
    ) values (
      nullif(lower(btrim(p_payload->>'email')), ''),
      btrim(p_payload->>'display_name'),
      target_role,
      nullif(btrim(p_payload->>'fluig_username'), ''),
      nullif(btrim(p_payload->>'fluig_user_id'), ''),
      next_home_branch_id,
      next_active,
      next_approval,
      case when next_approval = 'APPROVED' then now() else null end,
      case when next_approval = 'APPROVED' then actor.id else null end,
      case when next_approval = 'REJECTED' then now() else null end,
      case when next_approval = 'REJECTED' then coalesce(nullif(btrim(p_payload->>'rejection_reason'), ''), 'Acesso bloqueado pelo administrador.') else null end
    ) returning * into saved_profile;
    event_name := 'CREATED';
  else
    update public.app_user_profiles
    set email = case when p_payload ? 'email' then nullif(lower(btrim(p_payload->>'email')), '') else email end,
        display_name = case when p_payload ? 'display_name' then btrim(p_payload->>'display_name') else display_name end,
        role = target_role,
        fluig_username = case when p_payload ? 'fluig_username' then nullif(btrim(p_payload->>'fluig_username'), '') else fluig_username end,
        fluig_user_id = case when p_payload ? 'fluig_user_id' then nullif(btrim(p_payload->>'fluig_user_id'), '') else fluig_user_id end,
        home_branch_id = case when p_payload ? 'home_branch_id' then next_home_branch_id else home_branch_id end,
        active = next_active,
        approval_status = next_approval,
        approved_at = case when next_approval = 'APPROVED' then coalesce(approved_at, now()) else null end,
        approved_by_user_id = case when next_approval = 'APPROVED' then coalesce(approved_by_user_id, actor.id) else null end,
        rejected_at = case when next_approval = 'REJECTED' then coalesce(rejected_at, now()) else null end,
        rejection_reason = case
          when next_approval = 'REJECTED' then coalesce(
            nullif(btrim(p_payload->>'rejection_reason'), ''),
            rejection_reason,
            'Acesso bloqueado pelo administrador.'
          )
          else null
        end,
        updated_at = now()
    where id = target_id
    returning * into saved_profile;

    event_name := case
      when current_profile.approval_status <> 'APPROVED' and saved_profile.approval_status = 'APPROVED' then 'APPROVED'
      when saved_profile.approval_status = 'REJECTED' and current_profile.approval_status <> 'REJECTED' then 'BLOCKED'
      else 'UPDATED'
    end;
  end if;

  if p_payload ? 'branch_ids' then
    delete from public.app_user_branch_access where user_id = saved_profile.id;
    if cardinality(branch_ids) > 0 then
      insert into public.app_user_branch_access (
        user_id, branch_id, can_view, can_create, is_home
      )
      select
        saved_profile.id,
        branch_id,
        true,
        true,
        branch_id = next_home_branch_id
      from unnest(branch_ids) branch_id;
    end if;
    event_name := case when event_name = 'UPDATED' then 'ACCESS_CHANGED' else event_name end;
  end if;

  if p_payload ? 'page_access' then
    delete from public.app_user_page_access where user_id = saved_profile.id;

    for page_row in select value from jsonb_array_elements(coalesce(p_payload->'page_access', '[]'::jsonb))
    loop
      page_slug := nullif(btrim(page_row->>'pageSlug'), '');
      if page_slug is null or page_slug not in (
        'dashboard', 'despesas', 'pagamentos', 'contratos', 'fornecedores', 'produtos', 'compras',
        'cotacoes', 'manutencao', 'tarefas', 'checklists', 'usuarios', 'notificacoes', 'relatorios',
        'auditoria', 'configuracoes', 'perfil'
      ) then
        raise exception using message = 'USER_INVALID_PAGE_ACCESS';
      end if;
      if page_slug = 'usuarios' and target_role not in ('ADMIN_MASTER', 'ADMIN') then
        raise exception using message = 'USER_INVALID_PAGE_ACCESS';
      end if;

      insert into public.app_user_page_access (
        user_id, page_slug, can_view, can_create, can_update, can_approve
      ) values (
        saved_profile.id,
        page_slug,
        coalesce((page_row->>'canView')::boolean, true),
        coalesce((page_row->>'canCreate')::boolean, false),
        coalesce((page_row->>'canUpdate')::boolean, false),
        coalesce((page_row->>'canApprove')::boolean, false)
      );
    end loop;

    insert into public.app_user_page_access (user_id, page_slug, can_view)
    values
      (saved_profile.id, 'dashboard', true),
      (saved_profile.id, 'perfil', true)
    on conflict (user_id, page_slug) do update set can_view = true;
    event_name := case when event_name = 'UPDATED' then 'ACCESS_CHANGED' else event_name end;
  elsif p_payload ? 'page_slugs' then
    delete from public.app_user_page_access where user_id = saved_profile.id;
    insert into public.app_user_page_access (user_id, page_slug, can_view)
    select saved_profile.id, page_slug, true
    from (
      select distinct value as page_slug
      from jsonb_array_elements_text(coalesce(p_payload->'page_slugs', '[]'::jsonb))
      union select 'dashboard'
      union select 'perfil'
    ) pages
    where page_slug in (
      'dashboard', 'despesas', 'pagamentos', 'contratos', 'fornecedores', 'produtos', 'compras',
      'cotacoes', 'manutencao', 'tarefas', 'checklists', 'usuarios', 'notificacoes', 'relatorios',
      'auditoria', 'configuracoes', 'perfil'
    )
      and (page_slug <> 'usuarios' or target_role in ('ADMIN_MASTER', 'ADMIN'));
    event_name := case when event_name = 'UPDATED' then 'ACCESS_CHANGED' else event_name end;
  end if;

  insert into public.app_user_access_audit_events (
    user_id, actor_user_id, event_type, before_payload, after_payload, metadata
  ) values (
    saved_profile.id,
    actor.id,
    event_name,
    case when current_profile.id is null then null else to_jsonb(current_profile) end,
    to_jsonb(saved_profile),
    jsonb_build_object(
      'branchAccessChanged', p_payload ? 'branch_ids',
      'pageAccessChanged', p_payload ? 'page_access' or p_payload ? 'page_slugs'
    )
  );

  return to_jsonb(saved_profile);
end;
$$;

alter table public.app_branch_audit_events enable row level security;
alter table public.app_user_access_audit_events enable row level security;

drop policy if exists "authenticated_read_app_branches" on public.app_branches;
create policy "scoped_read_app_branches"
  on public.app_branches for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active is true
        and profile.approval_status = 'APPROVED'
        and (
          profile.role in ('ADMIN_MASTER', 'ADMIN')
          or exists (
            select 1
            from public.app_user_branch_access access
            where access.user_id = profile.id
              and access.branch_id = app_branches.id
              and access.can_view is true
          )
        )
    )
  );

drop policy if exists "authenticated_read_app_user_profiles" on public.app_user_profiles;
create policy "users_read_own_profile"
  on public.app_user_profiles for select
  to authenticated
  using (
    auth_user_id = (select auth.uid())
    and active is true
    and approval_status = 'APPROVED'
  );

drop policy if exists "authenticated_read_app_user_branch_access" on public.app_user_branch_access;
create policy "users_read_own_branch_access"
  on public.app_user_branch_access for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.id = app_user_branch_access.user_id
        and profile.auth_user_id = (select auth.uid())
        and profile.active is true
        and profile.approval_status = 'APPROVED'
    )
  );

drop policy if exists "authenticated_read_app_user_page_access" on public.app_user_page_access;
create policy "users_read_own_page_access"
  on public.app_user_page_access for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.id = app_user_page_access.user_id
        and profile.auth_user_id = (select auth.uid())
        and profile.active is true
        and profile.approval_status = 'APPROVED'
    )
  );

create policy "admin_read_app_branch_audit_events"
  on public.app_branch_audit_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active is true
        and profile.approval_status = 'APPROVED'
        and profile.role in ('ADMIN_MASTER', 'ADMIN')
    )
  );

create policy "admin_read_app_user_access_audit_events"
  on public.app_user_access_audit_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      where profile.auth_user_id = (select auth.uid())
        and profile.active is true
        and profile.approval_status = 'APPROVED'
        and profile.role in ('ADMIN_MASTER', 'ADMIN')
    )
  );

grant select on public.app_branch_audit_events to authenticated;
grant select on public.app_user_access_audit_events to authenticated;
revoke insert, update, delete on public.app_branch_audit_events from authenticated;
revoke insert, update, delete on public.app_user_access_audit_events from authenticated;

revoke execute on function public.normalize_app_branch() from public, anon, authenticated;
revoke execute on function public.touch_branch_fluig_sync() from public, anon, authenticated;
revoke execute on function public.save_app_branch(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.delete_app_branch(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.save_app_user_access(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_app_branch(uuid, uuid, jsonb) to service_role;
grant execute on function public.delete_app_branch(uuid, uuid) to service_role;
grant execute on function public.save_app_user_access(uuid, jsonb) to service_role;
