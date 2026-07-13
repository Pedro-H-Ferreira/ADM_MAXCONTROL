-- Supplier reads are branch-scoped and mutations stay atomic even though the
-- application uses the service role on the server.

drop policy if exists "authenticated_read_app_suppliers" on public.app_suppliers;
create policy "authenticated_read_app_suppliers"
  on public.app_suppliers for select
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
    or (
      deleted_at is null
      and exists (
        select 1
        from public.app_supplier_branch_links supplier_branch
        join public.app_user_branch_access access
          on access.branch_id = supplier_branch.branch_id
        join public.app_user_profiles profile
          on profile.id = access.user_id
        where supplier_branch.supplier_id = app_suppliers.id
          and access.can_view = true
          and profile.auth_user_id = (select auth.uid())
          and profile.active = true
          and profile.approval_status = 'APPROVED'
      )
    )
  );

drop policy if exists "authenticated_read_app_supplier_branch_links" on public.app_supplier_branch_links;
create policy "authenticated_read_app_supplier_branch_links"
  on public.app_supplier_branch_links for select
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
    or exists (
      select 1
      from public.app_user_branch_access access
      join public.app_user_profiles profile
        on profile.id = access.user_id
      where access.branch_id = app_supplier_branch_links.branch_id
        and access.can_view = true
        and profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
    )
  );

drop policy if exists "authenticated_read_app_supplier_contacts" on public.app_supplier_contacts;
create policy "authenticated_read_app_supplier_contacts"
  on public.app_supplier_contacts for select
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
    or exists (
      select 1
      from public.app_supplier_branch_links supplier_branch
      join public.app_user_branch_access access
        on access.branch_id = supplier_branch.branch_id
      join public.app_user_profiles profile
        on profile.id = access.user_id
      where supplier_branch.supplier_id = app_supplier_contacts.supplier_id
        and access.can_view = true
        and profile.auth_user_id = (select auth.uid())
        and profile.active = true
        and profile.approval_status = 'APPROVED'
    )
  );

drop index if exists public.app_suppliers_cnpj_normalizado_unique;
create unique index app_suppliers_cnpj_normalizado_unique
  on public.app_suppliers (cnpj_normalizado)
  where cnpj_normalizado is not null;

create unique index if not exists app_supplier_branch_one_default_idx
  on public.app_supplier_branch_links (supplier_id)
  where default_branch is true;

create or replace function public.normalize_app_supplier_cnpj()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(new.cnpj, new.cnpj_normalizado, ''), '[^0-9]', '', 'g');
  if v_digits = '' then
    new.cnpj := null;
    new.cnpj_normalizado := null;
    return new;
  end if;
  if v_digits !~ '^[0-9]{14}$' then
    raise exception 'CNPJ deve conter 14 digitos.' using errcode = '23514';
  end if;
  new.cnpj_normalizado := v_digits;
  new.cnpj := format(
    '%s.%s.%s/%s-%s',
    substring(v_digits from 1 for 2),
    substring(v_digits from 3 for 3),
    substring(v_digits from 6 for 3),
    substring(v_digits from 9 for 4),
    substring(v_digits from 13 for 2)
  );
  return new;
end;
$$;

drop trigger if exists normalize_app_supplier_cnpj_before_write on public.app_suppliers;
create trigger normalize_app_supplier_cnpj_before_write
  before insert or update of cnpj, cnpj_normalizado on public.app_suppliers
  for each row execute function public.normalize_app_supplier_cnpj();

create or replace function public.prevent_linked_app_supplier_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from public.fluig_requests where app_supplier_id = old.id)
     or exists (select 1 from public.fluig_supplier_links where app_supplier_id = old.id)
     or exists (select 1 from public.app_fluig_launches where app_supplier_id = old.id)
     or exists (select 1 from public.app_supplier_branch_links where supplier_id = old.id)
     or exists (select 1 from public.app_supplier_contacts where supplier_id = old.id) then
    raise exception 'Fornecedor possui vinculos e deve ser excluido logicamente.' using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_linked_app_supplier_delete_before_delete on public.app_suppliers;
create trigger prevent_linked_app_supplier_delete_before_delete
  before delete on public.app_suppliers
  for each row execute function public.prevent_linked_app_supplier_delete();

alter table public.fluig_supplier_links
  drop constraint if exists fluig_supplier_links_adm_supplier_id_fkey;
alter table public.fluig_supplier_links
  add constraint fluig_supplier_links_adm_supplier_id_fkey
  foreign key (adm_supplier_id) references public.app_suppliers(id) on delete set null;

alter table public.fluig_supplier_links
  drop constraint if exists fluig_supplier_links_supplier_ids_match;
alter table public.fluig_supplier_links
  add constraint fluig_supplier_links_supplier_ids_match
  check (
    app_supplier_id is null
    or adm_supplier_id is null
    or app_supplier_id = adm_supplier_id
  );

create or replace function public.save_app_supplier(
  p_supplier_id uuid,
  p_actor_id uuid,
  p_payload jsonb,
  p_branch_ids uuid[] default null,
  p_event_type text default 'updated',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_supplier_id uuid := p_supplier_id;
  v_before public.app_suppliers;
  v_after public.app_suppliers;
  v_branch_id uuid;
  v_index integer := 0;
begin
  if p_actor_id is null or not exists (
    select 1
    from public.app_user_profiles profile
    where profile.id = p_actor_id
      and profile.active = true
      and profile.approval_status = 'APPROVED'
  ) then
    raise exception 'Usuario sem permissao para salvar fornecedor.' using errcode = '42501';
  end if;

  if nullif(btrim(p_payload ->> 'razao_social'), '') is null then
    raise exception 'Razao social e obrigatoria.' using errcode = '23514';
  end if;

  if nullif(p_payload ->> 'cnpj_normalizado', '') is not null
     and (p_payload ->> 'cnpj_normalizado') !~ '^[0-9]{14}$' then
    raise exception 'CNPJ normalizado invalido.' using errcode = '23514';
  end if;

  if v_supplier_id is null then
    insert into public.app_suppliers (
      cnpj, cnpj_normalizado, razao_social, nome_fantasia,
      inscricao_estadual, inscricao_municipal, categoria, status,
      email, telefone, contato_principal, contatos,
      cep, endereco, numero, complemento, bairro, cidade, uf, pais,
      observacoes, fluig_name, fluig_code, fluig_supplier_label,
      default_source_request_id, default_payload, source_system, sync_status,
      last_fluig_sync_at, created_by_user_id, updated_by_user_id
    ) values (
      nullif(p_payload ->> 'cnpj', ''), nullif(p_payload ->> 'cnpj_normalizado', ''),
      btrim(p_payload ->> 'razao_social'), nullif(p_payload ->> 'nome_fantasia', ''),
      nullif(p_payload ->> 'inscricao_estadual', ''), nullif(p_payload ->> 'inscricao_municipal', ''),
      nullif(p_payload ->> 'categoria', ''), coalesce(nullif(p_payload ->> 'status', ''), 'ATIVO'),
      nullif(p_payload ->> 'email', ''), nullif(p_payload ->> 'telefone', ''),
      nullif(p_payload ->> 'contato_principal', ''), coalesce(p_payload -> 'contatos', '[]'::jsonb),
      nullif(p_payload ->> 'cep', ''), nullif(p_payload ->> 'endereco', ''),
      nullif(p_payload ->> 'numero', ''), nullif(p_payload ->> 'complemento', ''),
      nullif(p_payload ->> 'bairro', ''), nullif(p_payload ->> 'cidade', ''),
      nullif(p_payload ->> 'uf', ''), coalesce(nullif(p_payload ->> 'pais', ''), 'BR'),
      nullif(p_payload ->> 'observacoes', ''), nullif(p_payload ->> 'fluig_name', ''),
      nullif(p_payload ->> 'fluig_code', ''), nullif(p_payload ->> 'fluig_supplier_label', ''),
      nullif(p_payload ->> 'default_source_request_id', ''), coalesce(p_payload -> 'default_payload', '{}'::jsonb),
      coalesce(nullif(p_payload ->> 'source_system', ''), 'LOCAL'),
      coalesce(nullif(p_payload ->> 'sync_status', ''), 'NAO_SINCRONIZADO'),
      nullif(p_payload ->> 'last_fluig_sync_at', '')::timestamptz,
      p_actor_id, p_actor_id
    )
    returning * into v_after;
    v_supplier_id := v_after.id;
  else
    select * into v_before
    from public.app_suppliers supplier
    where supplier.id = v_supplier_id
      and supplier.deleted_at is null
    for update;

    if not found then
      raise exception 'Fornecedor nao encontrado.' using errcode = 'P0002';
    end if;

    update public.app_suppliers supplier
    set cnpj = nullif(p_payload ->> 'cnpj', ''),
        cnpj_normalizado = nullif(p_payload ->> 'cnpj_normalizado', ''),
        razao_social = btrim(p_payload ->> 'razao_social'),
        nome_fantasia = nullif(p_payload ->> 'nome_fantasia', ''),
        inscricao_estadual = nullif(p_payload ->> 'inscricao_estadual', ''),
        inscricao_municipal = nullif(p_payload ->> 'inscricao_municipal', ''),
        categoria = nullif(p_payload ->> 'categoria', ''),
        status = coalesce(nullif(p_payload ->> 'status', ''), supplier.status),
        email = nullif(p_payload ->> 'email', ''),
        telefone = nullif(p_payload ->> 'telefone', ''),
        contato_principal = nullif(p_payload ->> 'contato_principal', ''),
        contatos = coalesce(p_payload -> 'contatos', '[]'::jsonb),
        cep = nullif(p_payload ->> 'cep', ''),
        endereco = nullif(p_payload ->> 'endereco', ''),
        numero = nullif(p_payload ->> 'numero', ''),
        complemento = nullif(p_payload ->> 'complemento', ''),
        bairro = nullif(p_payload ->> 'bairro', ''),
        cidade = nullif(p_payload ->> 'cidade', ''),
        uf = nullif(p_payload ->> 'uf', ''),
        pais = coalesce(nullif(p_payload ->> 'pais', ''), 'BR'),
        observacoes = nullif(p_payload ->> 'observacoes', ''),
        fluig_name = nullif(p_payload ->> 'fluig_name', ''),
        fluig_code = nullif(p_payload ->> 'fluig_code', ''),
        fluig_supplier_label = nullif(p_payload ->> 'fluig_supplier_label', ''),
        default_source_request_id = nullif(p_payload ->> 'default_source_request_id', ''),
        default_payload = coalesce(p_payload -> 'default_payload', '{}'::jsonb),
        source_system = coalesce(nullif(p_payload ->> 'source_system', ''), supplier.source_system),
        sync_status = coalesce(nullif(p_payload ->> 'sync_status', ''), supplier.sync_status),
        last_fluig_sync_at = nullif(p_payload ->> 'last_fluig_sync_at', '')::timestamptz,
        updated_by_user_id = p_actor_id
    where supplier.id = v_supplier_id
    returning * into v_after;
  end if;

  if p_branch_ids is not null then
    delete from public.app_supplier_branch_links link
    where link.supplier_id = v_supplier_id;

    foreach v_branch_id in array p_branch_ids loop
      insert into public.app_supplier_branch_links (
        supplier_id, branch_id, default_branch, metadata
      ) values (
        v_supplier_id, v_branch_id, v_index = 0, jsonb_build_object('source', 'supplier_crud')
      );
      v_index := v_index + 1;
    end loop;
  end if;

  insert into public.app_supplier_audit_events (
    supplier_id, actor_user_id, event_type, before_payload, after_payload, metadata
  ) values (
    v_supplier_id, p_actor_id, p_event_type,
    case when v_before.id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after), coalesce(p_metadata, '{}'::jsonb)
  );

  return v_supplier_id;
end;
$$;

create or replace function public.delete_app_supplier(
  p_supplier_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before public.app_suppliers;
  v_request_count integer;
  v_fluig_link_count integer;
  v_launch_count integer;
  v_branch_count integer;
  v_contact_count integer;
  v_has_links boolean;
begin
  select * into v_before
  from public.app_suppliers supplier
  where supplier.id = p_supplier_id
    and supplier.deleted_at is null
  for update;

  if not found then
    raise exception 'Fornecedor nao encontrado.' using errcode = 'P0002';
  end if;

  select count(*) into v_request_count from public.fluig_requests where app_supplier_id = p_supplier_id;
  select count(*) into v_fluig_link_count from public.fluig_supplier_links where app_supplier_id = p_supplier_id;
  select count(*) into v_launch_count from public.app_fluig_launches where app_supplier_id = p_supplier_id;
  select count(*) into v_branch_count from public.app_supplier_branch_links where supplier_id = p_supplier_id;
  select count(*) into v_contact_count from public.app_supplier_contacts where supplier_id = p_supplier_id;

  v_has_links := v_request_count + v_fluig_link_count + v_launch_count + v_branch_count + v_contact_count > 0;

  if v_has_links then
    update public.app_suppliers
    set status = 'INATIVO',
        deleted_at = now(),
        updated_by_user_id = p_actor_id
    where id = p_supplier_id;
  else
    delete from public.app_suppliers where id = p_supplier_id;
  end if;

  insert into public.app_supplier_audit_events (
    supplier_id, actor_user_id, event_type, before_payload, metadata
  ) values (
    case when v_has_links then p_supplier_id else null end,
    p_actor_id,
    case when v_has_links then 'soft_deleted' else 'deleted' end,
    to_jsonb(v_before),
    jsonb_build_object(
      'requestCount', v_request_count,
      'fluigLinkCount', v_fluig_link_count,
      'launchCount', v_launch_count,
      'branchCount', v_branch_count,
      'contactCount', v_contact_count
    )
  );

  return jsonb_build_object(
    'deleted', not v_has_links,
    'softDeleted', v_has_links,
    'links', jsonb_build_object(
      'requests', v_request_count,
      'fluigLinks', v_fluig_link_count,
      'launches', v_launch_count,
      'branches', v_branch_count,
      'contacts', v_contact_count
    )
  );
end;
$$;

revoke all on function public.save_app_supplier(uuid, uuid, jsonb, uuid[], text, jsonb) from public, anon, authenticated;
grant execute on function public.save_app_supplier(uuid, uuid, jsonb, uuid[], text, jsonb) to service_role;

revoke all on function public.delete_app_supplier(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_app_supplier(uuid, uuid) to service_role;

revoke all on function public.normalize_app_supplier_cnpj() from public, anon, authenticated;
revoke all on function public.prevent_linked_app_supplier_delete() from public, anon, authenticated;
