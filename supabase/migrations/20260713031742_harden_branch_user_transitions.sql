do $$
declare
  function_ddl text;
  original_ddl text;
begin
  select pg_get_functiondef('public.save_app_user_access(uuid,jsonb)'::regprocedure)
  into function_ddl;
  original_ddl := function_ddl;

  function_ddl := replace(
    function_ddl,
    E'  if current_profile.id = actor.id\n',
    E'  if current_profile.role in (''ADMIN_MASTER'', ''ADMIN'')\n     and target_role not in (''ADMIN_MASTER'', ''ADMIN'')\n     and not (p_payload ? ''branch_ids'') then\n    raise exception using message = ''USER_INVALID_BRANCH_MATRIX'';\n  end if;\n\n  if current_profile.id = actor.id\n'
  );

  function_ddl := replace(
    function_ddl,
    E'  if current_profile.role = ''ADMIN_MASTER''\n     and (target_role <> ''ADMIN_MASTER'' or not next_active or next_approval <> ''APPROVED'')\n     and (\n',
    E'  if current_profile.role = ''ADMIN_MASTER''\n     and (target_role <> ''ADMIN_MASTER'' or not next_active or next_approval <> ''APPROVED'') then\n    perform pg_advisory_xact_lock(hashtextextended(''app_user_profiles:last_admin_master'', 0));\n  end if;\n\n  if current_profile.role = ''ADMIN_MASTER''\n     and (target_role <> ''ADMIN_MASTER'' or not next_active or next_approval <> ''APPROVED'')\n     and (\n'
  );

  if function_ddl = original_ddl
     or function_ddl not like '%USER_INVALID_BRANCH_MATRIX%pg_advisory_xact_lock%app_user_profiles:last_admin_master%' then
    raise exception 'Nao foi possivel endurecer as transicoes administrativas.';
  end if;
  execute function_ddl;

  select pg_get_functiondef('public.save_app_branch(uuid,uuid,jsonb)'::regprocedure)
  into function_ddl;
  original_ddl := function_ddl;

  function_ddl := replace(
    function_ddl,
    E'  if p_branch_id is not null and next_code <> current_branch.code then\n',
    E'  if p_branch_id is not null\n     and current_branch.active is true\n     and next_active is false\n     and exists (\n       select 1\n       from public.app_user_profiles profile\n       where profile.home_branch_id = p_branch_id\n         and profile.active is true\n         and profile.approval_status = ''APPROVED''\n     ) then\n    raise exception using message = ''BRANCH_HOME_IN_USE'';\n  end if;\n\n  if p_branch_id is not null and next_code <> current_branch.code then\n'
  );

  if function_ddl = original_ddl or function_ddl not like '%BRANCH_HOME_IN_USE%' then
    raise exception 'Nao foi possivel proteger a inativacao da filial principal.';
  end if;
  execute function_ddl;

  select pg_get_functiondef('public.delete_app_branch(uuid,uuid)'::regprocedure)
  into function_ddl;
  original_ddl := function_ddl;

  function_ddl := replace(
    function_ddl,
    E'  select\n    (select count(*) from public.app_user_branch_access where branch_id = p_branch_id)\n',
    E'  if exists (\n    select 1\n    from public.app_user_profiles profile\n    where profile.home_branch_id = p_branch_id\n      and profile.active is true\n      and profile.approval_status = ''APPROVED''\n  ) then\n    raise exception using message = ''BRANCH_HOME_IN_USE'';\n  end if;\n\n  select\n    (select count(*) from public.app_user_branch_access where branch_id = p_branch_id)\n'
  );

  if function_ddl = original_ddl or function_ddl not like '%BRANCH_HOME_IN_USE%' then
    raise exception 'Nao foi possivel proteger a exclusao da filial principal.';
  end if;
  execute function_ddl;
end;
$$;

revoke execute on function public.save_app_user_access(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.save_app_branch(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.delete_app_branch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_app_user_access(uuid, jsonb) to service_role;
grant execute on function public.save_app_branch(uuid, uuid, jsonb) to service_role;
grant execute on function public.delete_app_branch(uuid, uuid) to service_role;
