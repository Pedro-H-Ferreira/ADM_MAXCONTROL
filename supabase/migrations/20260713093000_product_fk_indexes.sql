create index if not exists app_products_first_fluig_request_idx
  on public.app_products (first_fluig_request_id);
create index if not exists app_products_created_by_user_idx
  on public.app_products (created_by_user_id);
create index if not exists app_products_updated_by_user_idx
  on public.app_products (updated_by_user_id);

create index if not exists app_product_branch_links_first_occurrence_idx
  on public.app_product_branch_links (first_occurrence_id);
create index if not exists app_product_branch_links_last_occurrence_idx
  on public.app_product_branch_links (last_occurrence_id);
create index if not exists app_product_branch_links_created_by_user_idx
  on public.app_product_branch_links (created_by_user_id);
create index if not exists app_product_branch_links_updated_by_user_idx
  on public.app_product_branch_links (updated_by_user_id);

create index if not exists app_product_price_history_created_by_user_idx
  on public.app_product_price_history (created_by_user_id);
