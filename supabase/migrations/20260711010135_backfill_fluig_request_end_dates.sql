-- Substitui a data de observacao usada no primeiro backfill pela data real de
-- encerramento retornada no payload historico do Fluig.
with ended as (
  select
    id,
    (raw_payload #>> '{raw,endDate}')::timestamptz as ended_at
  from public.fluig_requests
  where normalized_status in ('finalizado', 'cancelado')
    and nullif(raw_payload #>> '{raw,endDate}', '') is not null
    and (raw_payload #>> '{raw,endDate}') ~ '^\d{4}-\d{2}-\d{2}T'
)
update public.fluig_requests request
set
  finalized_at = case
    when request.normalized_status = 'finalizado' then ended.ended_at
    else null
  end,
  closed_at = ended.ended_at,
  canceled_at = case
    when request.normalized_status = 'cancelado' then ended.ended_at
    else null
  end,
  updated_at = now()
from ended
where request.id = ended.id
  and (
    request.closed_at is distinct from ended.ended_at
    or (
      request.normalized_status = 'finalizado'
      and request.finalized_at is distinct from ended.ended_at
    )
    or (
      request.normalized_status = 'cancelado'
      and request.canceled_at is distinct from ended.ended_at
    )
  );
