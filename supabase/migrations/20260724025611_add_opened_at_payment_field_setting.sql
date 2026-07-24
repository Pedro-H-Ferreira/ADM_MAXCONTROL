insert into public.fluig_field_settings (
  module_slug,
  field_key,
  label,
  source_type,
  active,
  visible_in_list,
  list_order,
  visible_in_form,
  form_order
)
values (
  'pagamentos',
  'openedAt',
  'Data e hora da abertura',
  'request',
  true,
  true,
  75,
  false,
  null
)
on conflict (module_slug, field_key) do update
set
  label = excluded.label,
  source_type = excluded.source_type,
  active = true,
  visible_in_list = true,
  list_order = excluded.list_order,
  visible_in_form = false,
  form_order = null,
  updated_at = now();
