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

create or replace function public.app_maintenance_transfer_asset(
  p_asset_id uuid,
  p_to_branch_id uuid,
  p_to_area text,
  p_to_location text,
  p_to_responsible_user_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns public.app_maintenance_assets
language plpgsql
security definer
set search_path = ''
as $$
declare current_asset public.app_maintenance_assets%rowtype; result_asset public.app_maintenance_assets%rowtype;
begin
  if nullif(btrim(p_reason),'') is null then raise exception 'Motivo da transferencia obrigatorio.'; end if;
  select * into current_asset from public.app_maintenance_assets where id=p_asset_id and deleted_at is null for update;
  if current_asset.id is null then raise exception 'Ativo nao encontrado.'; end if;
  if not exists(select 1 from public.app_branches where id=p_to_branch_id and active) then raise exception 'Filial de destino invalida.'; end if;
  update public.app_maintenance_assets
  set branch_id=p_to_branch_id,area=nullif(btrim(p_to_area),''),physical_location=nullif(btrim(p_to_location),''),
      responsible_user_id=p_to_responsible_user_id,updated_by_user_id=p_actor_user_id,updated_at=now()
  where id=p_asset_id returning * into result_asset;
  insert into public.app_maintenance_asset_events(asset_id,event_type,label,from_branch_id,to_branch_id,from_area,to_area,from_responsible_user_id,to_responsible_user_id,event_payload,actor_user_id)
  values(p_asset_id,'TRANSFER','Ativo transferido',current_asset.branch_id,p_to_branch_id,current_asset.area,p_to_area,current_asset.responsible_user_id,p_to_responsible_user_id,jsonb_build_object('reason',p_reason,'fromLocation',current_asset.physical_location,'toLocation',p_to_location),p_actor_user_id);
  insert into public.app_maintenance_audit_events(entity_type,entity_id,action,branch_id,actor_user_id,before_data,after_data)
  values('ASSET',p_asset_id::text,'TRANSFER',p_to_branch_id,p_actor_user_id,to_jsonb(current_asset),to_jsonb(result_asset));
  return result_asset;
end;
$$;

create or replace function public.app_maintenance_retire_asset(p_asset_id uuid,p_actor_user_id uuid,p_reason text)
returns public.app_maintenance_assets
language plpgsql
security definer
set search_path = ''
as $$
declare current_asset public.app_maintenance_assets%rowtype; result_asset public.app_maintenance_assets%rowtype;
begin
  if nullif(btrim(p_reason),'') is null then raise exception 'Motivo da baixa obrigatorio.'; end if;
  select * into current_asset from public.app_maintenance_assets where id=p_asset_id and deleted_at is null for update;
  if current_asset.id is null then raise exception 'Ativo nao encontrado.'; end if;
  if current_asset.status='BAIXADO' then raise exception 'Ativo ja baixado.'; end if;
  if exists(select 1 from public.app_maintenance_orders where asset_id=p_asset_id and deleted_at is null and status not in ('FINALIZADA','CANCELADA')) then raise exception 'Ativo possui OS aberta.'; end if;
  update public.app_maintenance_assets set status='BAIXADO',retired_at=now(),retirement_reason=btrim(p_reason),updated_by_user_id=p_actor_user_id,updated_at=now()
  where id=p_asset_id returning * into result_asset;
  insert into public.app_maintenance_asset_events(asset_id,event_type,label,event_payload,actor_user_id)
  values(p_asset_id,'RETIRED','Ativo baixado',jsonb_build_object('reason',p_reason),p_actor_user_id);
  insert into public.app_maintenance_audit_events(entity_type,entity_id,action,branch_id,actor_user_id,before_data,after_data)
  values('ASSET',p_asset_id::text,'RETIRED',current_asset.branch_id,p_actor_user_id,to_jsonb(current_asset),to_jsonb(result_asset));
  return result_asset;
end;
$$;

create or replace function public.app_maintenance_record_meter(
  p_asset_id uuid,p_meter_type text,p_reading numeric,p_read_at timestamptz,p_actor_user_id uuid,p_notes text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare current_asset public.app_maintenance_assets%rowtype; reading_id bigint;
begin
  select * into current_asset from public.app_maintenance_assets where id=p_asset_id and deleted_at is null for update;
  if current_asset.id is null then raise exception 'Ativo nao encontrado.'; end if;
  if p_meter_type not in ('HOURS','KM','CYCLES') then raise exception 'Tipo de medidor invalido.'; end if;
  if p_reading<current_asset.current_meter then raise exception 'Leitura nao pode ser menor que a atual (%).',current_asset.current_meter; end if;
  insert into public.app_maintenance_meter_readings(asset_id,meter_type,reading,read_at,notes,actor_user_id)
  values(p_asset_id,p_meter_type,p_reading,coalesce(p_read_at,now()),p_notes,p_actor_user_id) returning id into reading_id;
  update public.app_maintenance_assets set meter_type=p_meter_type,current_meter=p_reading,updated_by_user_id=p_actor_user_id,updated_at=now() where id=p_asset_id;
  insert into public.app_maintenance_asset_events(asset_id,event_type,label,event_payload,actor_user_id)
  values(p_asset_id,'METER_READING','Leitura de medidor registrada',jsonb_build_object('readingId',reading_id,'meterType',p_meter_type,'previous',current_asset.current_meter,'reading',p_reading),p_actor_user_id);
  return reading_id;
end;
$$;

create or replace function public.app_maintenance_approve_inventory(p_inventory_id uuid,p_actor_user_id uuid)
returns public.app_maintenance_inventory_counts
language plpgsql
security definer
set search_path = ''
as $$
declare inventory public.app_maintenance_inventory_counts%rowtype; item record; final_quantity numeric; delta numeric; movement_id bigint; result_inventory public.app_maintenance_inventory_counts%rowtype;
begin
  select * into inventory from public.app_maintenance_inventory_counts where id=p_inventory_id for update;
  if inventory.id is null then raise exception 'Inventario nao encontrado.'; end if;
  if inventory.status not in ('SUBMITTED','RECOUNT') then raise exception 'Inventario nao esta pronto para aprovacao.'; end if;
  if inventory.inventory_type='MATERIAL' then
    for item in select * from public.app_maintenance_inventory_items where inventory_count_id=p_inventory_id for update loop
      final_quantity:=coalesce(item.second_count_quantity,item.first_count_quantity);
      if final_quantity is null then raise exception 'Item de inventario sem contagem.'; end if;
      delta:=final_quantity-coalesce(item.reference_quantity,0);
      if delta<>0 and nullif(btrim(item.justification),'') is null then raise exception 'Divergencia sem justificativa.'; end if;
      movement_id:=null;
      if delta>0 then
        movement_id:=public.app_maintenance_post_stock_movement('INVENTORY_IN',item.material_id,delta,null,item.location_id,null,null,p_inventory_id,0,p_actor_user_id,'Ajuste de inventario',inventory.code,item.justification,false);
      elsif delta<0 then
        movement_id:=public.app_maintenance_post_stock_movement('INVENTORY_OUT',item.material_id,abs(delta),item.location_id,null,null,null,p_inventory_id,0,p_actor_user_id,'Ajuste de inventario',inventory.code,item.justification,false);
      end if;
      update public.app_maintenance_inventory_items set variance_quantity=delta,adjustment_movement_id=movement_id,resolution=case when delta=0 then 'SEM_DIVERGENCIA' else 'AJUSTADO' end,updated_at=now() where id=item.id;
    end loop;
  else
    if exists(select 1 from public.app_maintenance_inventory_items where inventory_count_id=p_inventory_id and asset_found is null) then raise exception 'Inventario possui ativos sem conferencia.'; end if;
  end if;
  update public.app_maintenance_inventory_counts set status='APPROVED',approved_at=now(),approved_by_user_id=p_actor_user_id,updated_by_user_id=p_actor_user_id,updated_at=now()
  where id=p_inventory_id returning * into result_inventory;
  insert into public.app_maintenance_audit_events(entity_type,entity_id,action,branch_id,actor_user_id,after_data)
  values('INVENTORY',p_inventory_id::text,'APPROVED',inventory.branch_id,p_actor_user_id,jsonb_build_object('inventoryType',inventory.inventory_type));
  return result_inventory;
end;
$$;

revoke execute on function public.app_maintenance_transition_order(uuid,text,uuid,text) from public,anon,authenticated;
revoke execute on function public.app_maintenance_transfer_asset(uuid,uuid,text,text,uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.app_maintenance_retire_asset(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.app_maintenance_record_meter(uuid,text,numeric,timestamptz,uuid,text) from public,anon,authenticated;
revoke execute on function public.app_maintenance_approve_inventory(uuid,uuid) from public,anon,authenticated;
grant execute on function public.app_maintenance_transition_order(uuid,text,uuid,text) to service_role;
grant execute on function public.app_maintenance_transfer_asset(uuid,uuid,text,text,uuid,uuid,text) to service_role;
grant execute on function public.app_maintenance_retire_asset(uuid,uuid,text) to service_role;
grant execute on function public.app_maintenance_record_meter(uuid,text,numeric,timestamptz,uuid,text) to service_role;
grant execute on function public.app_maintenance_approve_inventory(uuid,uuid) to service_role;
