drop policy if exists "branch_scoped_product_read" on public.app_products;
create policy "branch_scoped_product_read"
  on public.app_products for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.app_user_profiles profile
      join public.app_user_page_access page_access
        on page_access.user_id = profile.id
       and page_access.page_slug = 'produtos'
       and page_access.can_view
      where profile.auth_user_id = (select auth.uid())
        and profile.active
        and profile.approval_status = 'APPROVED'
        and (
          page_access.can_approve
          or profile.role in ('ADMIN_MASTER', 'ADMIN')
          or exists (
            select 1
            from public.app_product_branch_links branch_link
            join public.app_user_branch_access branch_access
              on branch_access.user_id = profile.id
             and branch_access.branch_id = branch_link.branch_id
             and branch_access.can_view
            where branch_link.product_id = app_products.id
              and branch_link.active
          )
          or exists (
            select 1
            from public.app_product_occurrences occurrence
            join public.app_user_branch_access branch_access
              on branch_access.user_id = profile.id
             and branch_access.can_view
            left join public.app_branches branch
              on branch.id = branch_access.branch_id
            where occurrence.product_id = app_products.id
              and (
                occurrence.branch_id = branch_access.branch_id
                or occurrence.branch_code = branch.code
              )
          )
        )
    )
  );

drop policy if exists "branch_scoped_product_occurrence_read" on public.app_product_occurrences;
create policy "branch_scoped_product_occurrence_read"
  on public.app_product_occurrences for select
  to authenticated
  using (
    exists (
      select 1
      from public.app_user_profiles profile
      join public.app_user_page_access page_access
        on page_access.user_id = profile.id
       and page_access.page_slug = 'produtos'
       and page_access.can_view
      where profile.auth_user_id = (select auth.uid())
        and profile.active
        and profile.approval_status = 'APPROVED'
        and (
          page_access.can_approve
          or profile.role in ('ADMIN_MASTER', 'ADMIN')
          or exists (
            select 1
            from public.app_user_branch_access branch_access
            left join public.app_branches branch
              on branch.id = branch_access.branch_id
            where branch_access.user_id = profile.id
              and branch_access.can_view
              and (
                app_product_occurrences.branch_id = branch_access.branch_id
                or app_product_occurrences.branch_code = branch.code
              )
          )
        )
    )
  );
