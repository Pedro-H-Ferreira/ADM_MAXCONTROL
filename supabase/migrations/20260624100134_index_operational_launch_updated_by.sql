create index if not exists app_fluig_launches_updated_by_idx
  on public.app_fluig_launches (updated_by_user_id, updated_at desc)
  where updated_by_user_id is not null;
