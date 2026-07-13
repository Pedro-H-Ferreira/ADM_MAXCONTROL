do $$
declare
  function_ddl text;
begin
  select pg_get_functiondef('public.save_app_user_access(uuid,jsonb)'::regprocedure)
  into function_ddl;

  function_ddl := replace(function_ddl, '  page_slug text;', '  current_page_slug text;');
  function_ddl := replace(function_ddl, '      page_slug := nullif', '      current_page_slug := nullif');
  function_ddl := replace(function_ddl, 'if page_slug is null or page_slug not in', 'if current_page_slug is null or current_page_slug not in');
  function_ddl := replace(function_ddl, 'if page_slug = ''usuarios'' and', 'if current_page_slug = ''usuarios'' and');
  function_ddl := replace(
    function_ddl,
    E'        saved_profile.id,\n        page_slug,\n        coalesce',
    E'        saved_profile.id,\n        current_page_slug,\n        coalesce'
  );

  if function_ddl like '%  page_slug text;%'
     or function_ddl like '%      page_slug := nullif%'
     or function_ddl like E'%        saved_profile.id,\n        page_slug,\n        coalesce%' then
    raise exception 'Nao foi possivel corrigir a ambiguidade da RPC de usuarios.';
  end if;

  execute function_ddl;
end;
$$;

revoke execute on function public.save_app_user_access(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_app_user_access(uuid, jsonb) to service_role;
