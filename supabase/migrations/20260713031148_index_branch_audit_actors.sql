create index if not exists app_branch_audit_events_actor_user_idx
  on public.app_branch_audit_events (actor_user_id)
  where actor_user_id is not null;

create index if not exists app_user_access_audit_events_actor_user_idx
  on public.app_user_access_audit_events (actor_user_id)
  where actor_user_id is not null;
