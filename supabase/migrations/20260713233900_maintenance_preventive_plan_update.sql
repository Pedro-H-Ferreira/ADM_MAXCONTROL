create or replace function public.app_maintenance_update_preventive_plan(
  p_plan_id uuid,
  p_data jsonb,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_plan_id is null or p_data is null then raise exception 'Plano preventivo invalido.'; end if;

  update public.app_maintenance_preventive_plans
  set code = btrim(p_data->>'code'),
      name = btrim(p_data->>'name'),
      description = btrim(p_data->>'description'),
      branch_id = nullif(p_data->>'branchId', '')::uuid,
      checklist_template_id = nullif(p_data->>'checklistTemplateId', '')::uuid,
      recurrence_value = (p_data->>'recurrenceValue')::numeric,
      recurrence_unit = p_data->>'recurrenceUnit',
      expected_minutes = nullif(p_data->>'expectedMinutes', '')::integer,
      responsible_user_id = nullif(p_data->>'responsibleUserId', '')::uuid,
      responsible_name = nullif(btrim(p_data->>'responsibleName'), ''),
      service_provider_id = nullif(p_data->>'serviceProviderId', '')::uuid,
      priority = p_data->>'priority',
      tolerance_before = coalesce((p_data->>'toleranceBefore')::integer, 0),
      tolerance_after = coalesce((p_data->>'toleranceAfter')::integer, 0),
      auto_generate_order = coalesce((p_data->>'autoGenerateOrder')::boolean, true),
      generation_lead_days = coalesce((p_data->>'generationLeadDays')::integer, 0),
      next_due_at = nullif(p_data->>'nextDueAt', '')::timestamptz,
      next_meter_value = nullif(p_data->>'nextMeterValue', '')::numeric,
      notify_before_days = coalesce((p_data->>'notifyBeforeDays')::integer, 7),
      evidence_required = coalesce((p_data->>'evidenceRequired')::boolean, false),
      completion_approval_required = coalesce((p_data->>'completionApprovalRequired')::boolean, false),
      active = coalesce((p_data->>'active')::boolean, active),
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
  where id = p_plan_id and deleted_at is null;
  if not found then raise exception 'Plano preventivo nao encontrado.'; end if;

  delete from public.app_maintenance_preventive_plan_assets where plan_id = p_plan_id;
  insert into public.app_maintenance_preventive_plan_assets(plan_id, asset_id)
  select p_plan_id, value::uuid
  from jsonb_array_elements_text(coalesce(p_data->'assetIds', '[]'::jsonb));
  if not found then raise exception 'Vincule pelo menos um ativo.'; end if;

  delete from public.app_maintenance_preventive_plan_tasks where plan_id = p_plan_id;
  insert into public.app_maintenance_preventive_plan_tasks(plan_id, position, title, description, expected_minutes, required, evidence_required)
  select p_plan_id,
         ordinality::integer,
         btrim(item->>'title'),
         nullif(btrim(item->>'description'), ''),
         nullif(item->>'expectedMinutes', '')::integer,
         coalesce((item->>'required')::boolean, true),
         coalesce((item->>'evidenceRequired')::boolean, false)
  from jsonb_array_elements(coalesce(p_data->'tasks', '[]'::jsonb)) with ordinality as task(item, ordinality)
  where nullif(btrim(item->>'title'), '') is not null;

  delete from public.app_maintenance_preventive_plan_materials where plan_id = p_plan_id;
  insert into public.app_maintenance_preventive_plan_materials(plan_id, material_id, planned_quantity, notes)
  select p_plan_id,
         (item->>'materialId')::uuid,
         (item->>'quantity')::numeric,
         nullif(btrim(item->>'notes'), '')
  from jsonb_array_elements(coalesce(p_data->'materials', '[]'::jsonb)) item
  where nullif(item->>'materialId', '') is not null and (item->>'quantity')::numeric > 0;

  return p_plan_id;
end;
$$;

revoke execute on function public.app_maintenance_update_preventive_plan(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.app_maintenance_update_preventive_plan(uuid, jsonb, uuid) to service_role;
