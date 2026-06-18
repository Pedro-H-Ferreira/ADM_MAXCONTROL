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
