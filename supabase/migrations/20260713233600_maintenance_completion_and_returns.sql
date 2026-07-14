-- Completion approval and stock returns must be transactional so the work
-- order, audit trail and inventory cannot diverge after partial failures.

create or replace function public.app_maintenance_recalculate_order_cost(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  material_total bigint;
  labor_total bigint;
begin
  select coalesce(sum(round(greatest(consumed_quantity - returned_quantity, 0) * unit_cost_cents)), 0)::bigint
    into material_total
  from public.app_maintenance_order_materials
  where order_id = p_order_id;

  select coalesce(sum(total_cost_cents), 0)::bigint
    into labor_total
  from public.app_maintenance_order_labor
  where order_id = p_order_id;

  update public.app_maintenance_orders
  set material_cost_cents = material_total,
      labor_cost_cents = labor_total,
      total_cost_cents = material_total + labor_total + other_cost_cents,
      updated_at = now()
  where id = p_order_id;
end;
$$;

create or replace function public.app_maintenance_return_order_material(
  p_order_material_id uuid,
  p_to_location_id uuid,
  p_quantity numeric,
  p_actor_user_id uuid,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_material public.app_maintenance_order_materials%rowtype;
  current_order public.app_maintenance_orders%rowtype;
  destination_branch_id uuid;
  available_to_return numeric(18,3);
  movement_id bigint;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantidade deve ser maior que zero.';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Informe o motivo da devolucao.';
  end if;

  select * into order_material
  from public.app_maintenance_order_materials
  where id = p_order_material_id
  for update;
  if order_material.id is null then raise exception 'Material da OS nao encontrado.'; end if;

  select * into current_order
  from public.app_maintenance_orders
  where id = order_material.order_id and deleted_at is null
  for update;
  if current_order.id is null then raise exception 'OS nao encontrada.'; end if;

  select warehouse.branch_id into destination_branch_id
  from public.app_maintenance_storage_locations location
  join public.app_maintenance_warehouses warehouse on warehouse.id = location.warehouse_id
  where location.id = p_to_location_id and location.active and warehouse.active;
  if destination_branch_id is null then raise exception 'Local de devolucao invalido ou inativo.'; end if;
  if current_order.branch_id is not null and destination_branch_id <> current_order.branch_id then
    raise exception 'O local de devolucao deve pertencer a filial da OS.';
  end if;

  available_to_return := order_material.consumed_quantity - order_material.returned_quantity;
  if p_quantity > available_to_return then
    raise exception 'Quantidade excede o consumo liquido da OS. Disponivel para devolucao: %', available_to_return;
  end if;

  movement_id := public.app_maintenance_post_stock_movement(
    'RETURN_FROM_ORDER', order_material.material_id, p_quantity,
    null, p_to_location_id, order_material.order_id, current_order.asset_id, null,
    order_material.unit_cost_cents, p_actor_user_id, btrim(p_reason), null,
    'Devolucao vinculada ao material consumido na OS', false
  );

  update public.app_maintenance_order_materials
  set returned_quantity = returned_quantity + p_quantity,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where id = order_material.id;

  perform public.app_maintenance_recalculate_order_cost(order_material.order_id);

  insert into public.app_maintenance_order_events(
    order_id, actor_user_id, event_type, event_label, event_payload
  ) values (
    order_material.order_id, p_actor_user_id, 'MATERIAL_RETURNED', 'Material devolvido ao estoque',
    jsonb_build_object(
      'orderMaterialId', order_material.id,
      'materialId', order_material.material_id,
      'movementId', movement_id,
      'quantity', p_quantity,
      'locationId', p_to_location_id,
      'reason', btrim(p_reason)
    )
  );
  return movement_id;
end;
$$;

create or replace function public.app_maintenance_review_completion(
  p_order_id uuid,
  p_decision text,
  p_actor_user_id uuid,
  p_notes text
)
returns public.app_maintenance_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.app_maintenance_orders%rowtype;
  result_order public.app_maintenance_orders%rowtype;
  next_approval_status text;
begin
  if p_decision not in ('APPROVE', 'REJECT') then raise exception 'Decisao de aprovacao invalida.'; end if;
  if nullif(btrim(p_notes), '') is null then raise exception 'Informe um comentario para a decisao.'; end if;

  select * into current_order
  from public.app_maintenance_orders
  where id = p_order_id and deleted_at is null
  for update;
  if current_order.id is null then raise exception 'OS nao encontrada.'; end if;
  if current_order.approval_status <> 'PENDING' then raise exception 'A OS nao possui aprovacao pendente.'; end if;
  if current_order.status not in ('CONCLUIDA', 'AGUARDANDO_VALIDACAO') then
    raise exception 'Conclua a execucao antes da aprovacao.';
  end if;

  next_approval_status := case when p_decision = 'APPROVE' then 'APPROVED' else 'REJECTED' end;
  update public.app_maintenance_orders
  set approval_status = next_approval_status,
      approved_by = case when p_decision = 'APPROVE' then p_actor_user_id else null end,
      approved_at = case when p_decision = 'APPROVE' then now() else null end,
      approval_notes = btrim(p_notes),
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where id = p_order_id
  returning * into result_order;

  insert into public.app_maintenance_order_events(
    order_id, actor_user_id, event_type, event_label, event_payload
  ) values (
    p_order_id, p_actor_user_id, 'COMPLETION_' || next_approval_status,
    case when p_decision = 'APPROVE' then 'Conclusao aprovada' else 'Conclusao rejeitada' end,
    jsonb_build_object('decision', p_decision, 'notes', btrim(p_notes))
  );
  insert into public.app_maintenance_audit_events(
    entity_type, entity_id, action, branch_id, actor_user_id, before_data, after_data
  ) values (
    'WORK_ORDER', p_order_id::text, 'COMPLETION_' || next_approval_status,
    current_order.branch_id, p_actor_user_id,
    jsonb_build_object('approvalStatus', current_order.approval_status),
    jsonb_build_object('approvalStatus', next_approval_status, 'notes', btrim(p_notes))
  );
  return result_order;
end;
$$;

create or replace function public.app_maintenance_transition_order(
  p_order_id uuid,
  p_next_status text,
  p_actor_user_id uuid,
  p_comment text default null
)
returns public.app_maintenance_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.app_maintenance_orders%rowtype;
  result_order public.app_maintenance_orders%rowtype;
  allowed boolean := false;
  reservation record;
begin
  select * into current_order from public.app_maintenance_orders where id=p_order_id and deleted_at is null for update;
  if current_order.id is null then raise exception 'OS nao encontrada.'; end if;
  if p_next_status = current_order.status then return current_order; end if;

  allowed := case current_order.status
    when 'ABERTA' then p_next_status in ('EM_TRIAGEM','PLANEJADA','AGUARDANDO_APROVACAO','INICIADA','EM_EXECUCAO','CANCELADA')
    when 'EM_TRIAGEM' then p_next_status in ('PLANEJADA','AGUARDANDO_APROVACAO','AGUARDANDO_MATERIAL','PROGRAMADA','EM_EXECUCAO','CANCELADA')
    when 'PLANEJADA' then p_next_status in ('AGUARDANDO_APROVACAO','AGUARDANDO_MATERIAL','MATERIAL_RESERVADO','PROGRAMADA','EM_EXECUCAO','CANCELADA')
    when 'AGUARDANDO_APROVACAO' then p_next_status in ('PLANEJADA','AGUARDANDO_MATERIAL','PROGRAMADA','CANCELADA')
    when 'AGUARDANDO_MATERIAL' then p_next_status in ('MATERIAL_RESERVADO','PLANEJADA','CANCELADA')
    when 'MATERIAL_RESERVADO' then p_next_status in ('PROGRAMADA','INICIADA','EM_EXECUCAO','AGUARDANDO_MATERIAL','CANCELADA')
    when 'AGUARDANDO_TERCEIRO' then p_next_status in ('PROGRAMADA','EM_EXECUCAO','PAUSADA','CANCELADA')
    when 'PROGRAMADA' then p_next_status in ('INICIADA','EM_EXECUCAO','AGUARDANDO_MATERIAL','AGUARDANDO_TERCEIRO','CANCELADA')
    when 'INICIADA' then p_next_status in ('EM_EXECUCAO','PAUSADA','AGUARDANDO_MATERIAL','AGUARDANDO_TERCEIRO','CONCLUIDA','AGUARDANDO_VALIDACAO','FINALIZADA','CANCELADA')
    when 'EM_EXECUCAO' then p_next_status in ('PAUSADA','AGUARDANDO_MATERIAL','AGUARDANDO_TERCEIRO','CONCLUIDA','AGUARDANDO_VALIDACAO','FINALIZADA','CANCELADA')
    when 'PAUSADA' then p_next_status in ('EM_EXECUCAO','AGUARDANDO_MATERIAL','AGUARDANDO_TERCEIRO','CANCELADA')
    when 'CONCLUIDA' then p_next_status in ('AGUARDANDO_VALIDACAO','FINALIZADA','EM_EXECUCAO')
    when 'AGUARDANDO_VALIDACAO' then p_next_status in ('FINALIZADA','EM_EXECUCAO')
    else false
  end;
  if not allowed then raise exception 'Transicao de status invalida: % -> %',current_order.status,p_next_status; end if;
  if p_next_status = 'FINALIZADA' and current_order.approval_status in ('PENDING', 'REJECTED') then
    raise exception 'A conclusao precisa ser aprovada antes da finalizacao.';
  end if;

  if p_next_status='CANCELADA' then
    for reservation in
      select id from public.app_maintenance_stock_reservations
      where order_id=p_order_id and status in ('ACTIVE','PARTIAL') for update
    loop
      perform public.app_maintenance_release_reservation(reservation.id,null,p_actor_user_id,coalesce(nullif(btrim(p_comment),''),'Cancelamento da OS'));
    end loop;
  end if;

  update public.app_maintenance_orders
  set status=p_next_status,
      started_at=case when p_next_status in ('INICIADA','EM_EXECUCAO') then coalesce(started_at,now()) else started_at end,
      finished_at=case when p_next_status in ('CONCLUIDA','FINALIZADA') then coalesce(finished_at,now()) when p_next_status='EM_EXECUCAO' then null else finished_at end,
      completion_notes=case when p_next_status in ('CONCLUIDA','FINALIZADA') then coalesce(nullif(btrim(p_comment),''),completion_notes) else completion_notes end,
      updated_by_user_id=p_actor_user_id,
      updated_at=now()
  where id=p_order_id returning * into result_order;

  insert into public.app_maintenance_order_events(order_id,actor_user_id,event_type,event_label,status_from,status_to,event_payload)
  values(p_order_id,p_actor_user_id,'STATUS_CHANGED','Status alterado de '||current_order.status||' para '||p_next_status,current_order.status,p_next_status,jsonb_build_object('comment',p_comment));
  insert into public.app_maintenance_audit_events(entity_type,entity_id,action,branch_id,actor_user_id,before_data,after_data)
  values('WORK_ORDER',p_order_id::text,'STATUS_CHANGED',current_order.branch_id,p_actor_user_id,jsonb_build_object('status',current_order.status),jsonb_build_object('status',p_next_status,'comment',p_comment));
  return result_order;
end;
$$;

create or replace function public.app_maintenance_invalidate_completion_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.consumed_quantity, new.returned_quantity) is distinct from (old.consumed_quantity, old.returned_quantity) then
    update public.app_maintenance_orders
    set approval_status = 'PENDING',
        approved_by = null,
        approved_at = null,
        approval_notes = null,
        updated_at = now()
    where id = new.order_id
      and status not in ('FINALIZADA', 'CANCELADA')
      and approval_status in ('APPROVED', 'REJECTED');
  end if;
  return new;
end;
$$;

drop trigger if exists invalidate_maintenance_completion_approval on public.app_maintenance_order_materials;
create trigger invalidate_maintenance_completion_approval
after update of consumed_quantity, returned_quantity on public.app_maintenance_order_materials
for each row execute function public.app_maintenance_invalidate_completion_approval();

revoke execute on function public.app_maintenance_return_order_material(uuid,uuid,numeric,uuid,text) from public, anon, authenticated;
revoke execute on function public.app_maintenance_review_completion(uuid,text,uuid,text) from public, anon, authenticated;
revoke execute on function public.app_maintenance_recalculate_order_cost(uuid) from public, anon, authenticated;
grant execute on function public.app_maintenance_return_order_material(uuid,uuid,numeric,uuid,text) to service_role;
grant execute on function public.app_maintenance_review_completion(uuid,text,uuid,text) to service_role;
grant execute on function public.app_maintenance_recalculate_order_cost(uuid) to service_role;
