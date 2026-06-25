with requester_identity as (
  select
    id,
    coalesce(
      nullif(btrim(raw_payload #>> '{raw,requesterName}'), ''),
      nullif(btrim(raw_payload #>> '{raw,requester}'), ''),
      nullif(btrim(raw_payload #>> '{formFields,responsavelEnvio}'), ''),
      nullif(btrim(raw_payload #>> '{formFields,nomeColaborador}'), ''),
      nullif(btrim(raw_payload #>> '{formFields,colaboradorInput}'), '')
    ) as requester_name,
    coalesce(
      nullif(btrim(raw_payload #>> '{raw,requesterId}'), ''),
      nullif(btrim(raw_payload #>> '{raw,requesterCode}'), ''),
      nullif(btrim(raw_payload #>> '{formFields,matResponsavelEnvio}'), ''),
      nullif(btrim(raw_payload #>> '{formFields,matSolicitante}'), '')
    ) as requester_code
  from public.fluig_requests
  where raw_payload <> '{}'::jsonb
)
update public.fluig_requests as request
set
  requester = coalesce(nullif(btrim(request.requester), ''), identity.requester_name, identity.requester_code),
  fluig_requester_login = coalesce(
    nullif(btrim(request.fluig_requester_login), ''),
    identity.requester_name
  ),
  fluig_requester_code = coalesce(
    nullif(btrim(request.fluig_requester_code), ''),
    identity.requester_code
  )
from requester_identity as identity
where identity.id = request.id
  and (
    request.requester is null
    or request.fluig_requester_login is null
    or request.fluig_requester_code is null
  )
  and (identity.requester_name is not null or identity.requester_code is not null);
