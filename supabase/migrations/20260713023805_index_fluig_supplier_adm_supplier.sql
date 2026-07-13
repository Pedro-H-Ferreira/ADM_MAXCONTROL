create index if not exists fluig_supplier_links_adm_supplier_id_idx
  on public.fluig_supplier_links (adm_supplier_id)
  where adm_supplier_id is not null;
