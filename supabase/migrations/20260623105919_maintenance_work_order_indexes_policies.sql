create index if not exists app_maintenance_orders_requester_user_id_idx
  on public.app_maintenance_orders (requester_user_id);
create index if not exists app_maintenance_orders_created_by_user_id_idx
  on public.app_maintenance_orders (created_by_user_id);
create index if not exists app_maintenance_orders_updated_by_user_id_idx
  on public.app_maintenance_orders (updated_by_user_id);
create index if not exists app_maintenance_orders_fluig_request_row_id_idx
  on public.app_maintenance_orders (fluig_request_row_id);
create index if not exists app_maintenance_order_events_actor_user_id_idx
  on public.app_maintenance_order_events (actor_user_id);

drop policy if exists app_maintenance_orders_service_role_all on public.app_maintenance_orders;
create policy app_maintenance_orders_service_role_all
  on public.app_maintenance_orders
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists app_maintenance_order_events_service_role_all on public.app_maintenance_order_events;
create policy app_maintenance_order_events_service_role_all
  on public.app_maintenance_order_events
  for all
  to service_role
  using (true)
  with check (true);
