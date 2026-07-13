-- Materializa o ciclo de vida retornado pelo historico Fluig. Registros sem
-- classificacao conhecida permanecem nulos e nao entram nas filas operacionais.
with classified as (
  select
    id,
    case
      when upper(coalesce(status, '')) like '%CANCEL%' then 'cancelado'
      when upper(coalesce(status, '')) like any (array['%FINALIZ%', '%CONCLUID%', '%ENCERRAD%', '%FECHAD%'])
        or upper(coalesce(status, '')) in ('COMPLETED', 'DONE') then 'finalizado'
      when upper(coalesce(status, '')) = 'OPEN'
        or upper(coalesce(status, '')) like any (array['%ABERT%', '%ANDAMENTO%', '%PENDENT%']) then 'em_andamento'
      else null
    end as lifecycle,
    coalesce(last_synced_at, updated_at, now()) as observed_at
  from public.fluig_requests
)
update public.fluig_requests request
set
  normalized_status = classified.lifecycle,
  is_open = classified.lifecycle = 'em_andamento',
  finalized_at = case
    when classified.lifecycle = 'finalizado' then coalesce(request.finalized_at, classified.observed_at)
    else null
  end,
  closed_at = case
    when classified.lifecycle in ('finalizado', 'cancelado') then coalesce(request.closed_at, classified.observed_at)
    else null
  end,
  canceled_at = case
    when classified.lifecycle = 'cancelado' then coalesce(request.canceled_at, classified.observed_at)
    else null
  end,
  updated_at = now()
from classified
where request.id = classified.id
  and classified.lifecycle is not null
  and (
    request.normalized_status is distinct from classified.lifecycle
    or request.is_open is distinct from (classified.lifecycle = 'em_andamento')
    or (classified.lifecycle = 'finalizado' and request.finalized_at is null)
    or (classified.lifecycle in ('finalizado', 'cancelado') and request.closed_at is null)
    or (classified.lifecycle = 'cancelado' and request.canceled_at is null)
  );

analyze public.fluig_requests;
