create index if not exists fluig_request_events_request_id_idx
  on public.fluig_request_events (fluig_request_id);

create index if not exists fluig_supplier_links_candidate_id_idx
  on public.fluig_supplier_links (candidate_id);
