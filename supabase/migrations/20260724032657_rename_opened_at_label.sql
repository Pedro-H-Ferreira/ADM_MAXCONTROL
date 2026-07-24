update public.fluig_field_settings
set
  label = 'Abertura',
  updated_at = now()
where module_slug = 'pagamentos'
  and field_key = 'openedAt';
