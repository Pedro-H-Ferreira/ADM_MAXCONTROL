with corrupt_branches as (
  select
    branch.id as old_id,
    canonical.id as canonical_id
  from public.app_branches branch
  join public.app_branches canonical
    on canonical.code = substring(branch.code from '-([0-9]{3,6})$')
  where branch.code ~ '^[0-9]{7,}-[0-9]{3,6}$'
)
update public.app_user_profiles profile
set home_branch_id = corrupt.canonical_id
from corrupt_branches corrupt
where profile.home_branch_id = corrupt.old_id;

with corrupt_branches as (
  select branch.id as old_id, canonical.id as canonical_id
  from public.app_branches branch
  join public.app_branches canonical
    on canonical.code = substring(branch.code from '-([0-9]{3,6})$')
  where branch.code ~ '^[0-9]{7,}-[0-9]{3,6}$'
),
merged_access as (
  select
    access.user_id,
    corrupt.canonical_id as branch_id,
    bool_or(access.can_view) as can_view,
    bool_or(access.can_create) as can_create,
    bool_or(access.is_home) as is_home
  from public.app_user_branch_access access
  join corrupt_branches corrupt on corrupt.old_id = access.branch_id
  group by access.user_id, corrupt.canonical_id
)
insert into public.app_user_branch_access (
  user_id,
  branch_id,
  can_view,
  can_create,
  is_home
)
select user_id, branch_id, can_view, can_create, is_home
from merged_access
on conflict (user_id, branch_id)
do update set
  can_view = public.app_user_branch_access.can_view or excluded.can_view,
  can_create = public.app_user_branch_access.can_create or excluded.can_create,
  is_home = public.app_user_branch_access.is_home or excluded.is_home;

with corrupt_branches as (
  select branch.id as old_id
  from public.app_branches branch
  where branch.code ~ '^[0-9]{7,}-[0-9]{3,6}$'
)
delete from public.app_user_branch_access access
using corrupt_branches corrupt
where access.branch_id = corrupt.old_id;

with corrupt_branches as (
  select branch.id as old_id, canonical.id as canonical_id
  from public.app_branches branch
  join public.app_branches canonical
    on canonical.code = substring(branch.code from '-([0-9]{3,6})$')
  where branch.code ~ '^[0-9]{7,}-[0-9]{3,6}$'
)
update public.fluig_jobs job
set branch_id = corrupt.canonical_id
from corrupt_branches corrupt
where job.branch_id = corrupt.old_id;

with corrupt_branches as (
  select branch.id as old_id, canonical.id as canonical_id
  from public.app_branches branch
  join public.app_branches canonical
    on canonical.code = substring(branch.code from '-([0-9]{3,6})$')
  where branch.code ~ '^[0-9]{7,}-[0-9]{3,6}$'
)
update public.fluig_requests request
set branch_id = corrupt.canonical_id
from corrupt_branches corrupt
where request.branch_id = corrupt.old_id;

with corrupt_branches as (
  select branch.id as old_id, canonical.id as canonical_id
  from public.app_branches branch
  join public.app_branches canonical
    on canonical.code = substring(branch.code from '-([0-9]{3,6})$')
  where branch.code ~ '^[0-9]{7,}-[0-9]{3,6}$'
)
update public.app_maintenance_orders maintenance
set branch_id = corrupt.canonical_id
from corrupt_branches corrupt
where maintenance.branch_id = corrupt.old_id;

with corrupt_branches as (
  select branch.id as old_id, canonical.id as canonical_id
  from public.app_branches branch
  join public.app_branches canonical
    on canonical.code = substring(branch.code from '-([0-9]{3,6})$')
  where branch.code ~ '^[0-9]{7,}-[0-9]{3,6}$'
),
merged_links as (
  select
    link.supplier_id,
    corrupt.canonical_id as branch_id,
    bool_or(link.default_branch) as default_branch
  from public.app_supplier_branch_links link
  join corrupt_branches corrupt on corrupt.old_id = link.branch_id
  group by link.supplier_id, corrupt.canonical_id
)
insert into public.app_supplier_branch_links (
  supplier_id,
  branch_id,
  default_branch,
  metadata
)
select
  supplier_id,
  branch_id,
  default_branch,
  jsonb_build_object('source', 'fluig_branch_normalization')
from merged_links
on conflict (supplier_id, branch_id)
do update set
  default_branch = public.app_supplier_branch_links.default_branch or excluded.default_branch,
  metadata = public.app_supplier_branch_links.metadata || jsonb_build_object(
    'normalizedHistoricalBranch', true
  );

with corrupt_branches as (
  select branch.id as old_id
  from public.app_branches branch
  where branch.code ~ '^[0-9]{7,}-[0-9]{3,6}$'
)
delete from public.app_supplier_branch_links link
using corrupt_branches corrupt
where link.branch_id = corrupt.old_id;

with normalized_requests as (
  select
    request.id,
    coalesce(
      substring(request.branch_code from '-([0-9]{3,6})$'),
      substring(coalesce(request.branch_label, '') from '([0-9]{3,6})\s*-\s*[[:alpha:]]')
    ) as canonical_code
  from public.fluig_requests request
  where request.branch_code ~ '^[0-9]{7,}-[0-9]{3,6}$'
     or coalesce(request.branch_label, '') ~ '^[0-9]{7,}-[0-9]{3,6}\s*-'
)
update public.fluig_requests request
set branch_code = normalized.canonical_code,
    branch_label = regexp_replace(
      request.branch_label,
      '^[0-9]{7,}-[0-9]{3,6}\s*-\s*',
      normalized.canonical_code || ' - '
    )
from normalized_requests normalized
where request.id = normalized.id
  and normalized.canonical_code is not null;

update public.fluig_requests
set branch_code = null,
    branch_label = null,
    branch_id = null
where coalesce(branch_code, '') <> ''
  and branch_code !~ '^[0-9]{3,6}$';

update public.fluig_requests
set branch_code = null,
    branch_label = null,
    branch_id = null
where coalesce(branch_label, '') ~* '^\[object';

update public.fluig_supplier_candidates candidate
set suggested_defaults = jsonb_set(
      candidate.suggested_defaults,
      '{unidadeFilial}',
      to_jsonb(
        regexp_replace(
          candidate.suggested_defaults ->> 'unidadeFilial',
          '^[0-9]{7,}-([0-9]{3,6})\s*-\s*',
          '\1 - '
        )
      ),
      true
    ),
    updated_at = now()
where coalesce(candidate.suggested_defaults ->> 'unidadeFilial', '') ~ '^[0-9]{7,}-[0-9]{3,6}\s*-';

update public.app_suppliers supplier
set default_payload = jsonb_set(
      jsonb_set(
        supplier.default_payload,
        '{branchCode}',
        to_jsonb(substring(supplier.default_payload ->> 'branchCode' from '-([0-9]{3,6})$')),
        true
      ),
      '{branchLabel}',
      to_jsonb(
        coalesce(
          regexp_replace(
            supplier.default_payload ->> 'branchLabel',
            '^[0-9]{7,}-([0-9]{3,6})\s*-\s*',
            '\1 - '
          ),
          substring(supplier.default_payload ->> 'branchCode' from '-([0-9]{3,6})$')
        )
      ),
      true
    )
where coalesce(supplier.default_payload ->> 'branchCode', '') ~ '^[0-9]{7,}-[0-9]{3,6}$';

delete from public.fluig_catalog_items catalog
where catalog.catalog_type = 'branch'
  and (
    coalesce(catalog.code, '') !~ '^[0-9]{3,6}$'
    or coalesce(catalog.label, '') ~* '^\[object'
  );

delete from public.app_branches branch
where branch.metadata ->> 'source' = 'fluig_history'
  and branch.code !~ '^[0-9]{3,6}$';

delete from public.app_supplier_branch_links link
where link.metadata ->> 'source' = 'fluig_history_reconciliation'
  and not exists (
    select 1
    from public.fluig_requests request
    join public.app_branches branch
      on branch.id = link.branch_id
     and branch.code = request.branch_code
    where request.app_supplier_id = link.supplier_id
  );
