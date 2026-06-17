# Integracao Fluig no ADM MaxControL

## Decisao de produto

A integracao Fluig nao sera uma aba operacional separada. O ADM usa a API e os mapas tecnicos do projeto `D:\PROJETOS\FLUIG_WEB_AUTOMATION_NEXUS`, mas cada fluxo fica dentro da pagina natural do ERP:

- `/pagamentos`: abre e acompanha a Central de Lancamento Fluig para pagamentos.
- `/compras`: abre e acompanha Pedido de Compra Administrativa no Fluig.
- `/manutencao`: separa OS manual da ferramenta e OS integrada ao processo Fluig.
- `/fornecedores`: guarda mapa ERP -> Fluig usando CNPJ, nome Fluig e solicitacoes modelo.

## Telas Stitch usadas como referencia visual

As telas foram baixadas para `stitch-export/4660020320183620207/screens`. Os screenshots ficam apenas como referencia local e nao devem aparecer nas telas operacionais.

- `18.1. Detalhes de Pagamento` -> integrado em `/pagamentos`
- `18.2. Pedido de Compra` -> integrado em `/compras`
- `18.3. Manutencao e Lancamentos` -> integrado em `/manutencao`
- `18.4. Log de Sincronizacao` -> suporte visual para auditoria/sync
- `18.5. Visualizador de Diagrama` -> suporte visual para mapa tecnico
- `18.6. Espelhamento de Dados` -> integrado em `/fornecedores`
- `18. Painel de Sincronizacao Fluig` -> referencia de arquitetura, sem rota propria

## Manutencao

O modulo `/manutencao` tem dois fluxos:

- OS manual da ferramenta: nao abre processo no Fluig. O manutentor acessa pelo celular, ve a fila por prioridade/status e atualiza inicio, andamento, material utilizado, valor gasto, fotos, finalizacao ou motivo de pendencia.
- OS integrada ao Fluig: usa o processo `Solicitar_transferencia_baixas_ativo_fixo` e grava retorno, etapa, responsavel e `NumLancW` na OS.

Em `/manutencao/nova`, o primeiro controle operacional e a escolha entre `OS manual da ferramenta` e `OS integrada ao Fluig`; cada escolha mostra o conjunto correto de campos.

## Paginas Fluig exportadas

Pasta: `D:\PROJETOS\ADM_MAXCONTROL\FLUIG-EXPORT`

- `Anexar NF para Central de Lancamento.html`
  - Processo: `Atendimento Central de Lancamento - CONSINCO`
  - Uso no ADM: `/pagamentos`
  - Campos chave: `centroCusto`, `codigonaturezaC`, `formaPagamento`, `fornecedorC`, `codCNPJ`, `descricaoDemandaEnvio`, `nNotaFiscal`, `dataEmissaoNF`, `vencPagNota`, `unidadeFilial`, `valorNF`.
  - Exemplos anteriores: `1103651` e `1103369`.

- `Pedido de Compra Administrativa.html`
  - Processo: `Solicitacao de Compra Administrativa`
  - Uso no ADM: `/compras`
  - Evidencia: `taskUserId=00130`, usuario `Administrativo CD`, `WKVersDef=23`.
  - Campos chave: `responsavelPedido`, `dataPedido`, `numeroSolicitacao`, `centroCusto`, `contaCentroCusto`, `codFilialPedido` e itens da requisicao.

- `Solicitaremissaodenotafiscal.html`
  - Processo: `Solicitar_transferencia_baixas_ativo_fixo`
  - Uso no ADM: `/manutencao`
  - Evidencia: `taskUserId=00130`, grupo `EasyAtivos`, `WKVersDef=14`.
  - Campos chave: `codPatrimonio`, `tipoTransacao`, `filial`, `tipoBaixa`, `filialDestino`, `dataPrevSaida`, `dataPrevRetorno`, `zoomDemandaPara`, `obsFiscal`, `NumLancW`.

## API reaproveitada

O projeto `FLUIG_WEB_AUTOMATION_NEXUS` continua sendo referencia para autenticacao, endpoints e contratos tecnicos. O ADM nao importa a fila antiga nem o modelo antigo de lancamentos.

Endpoints tecnicos de referencia:

- `GET /fluig/suppliers`
- `GET /fluig/logs`
- `POST /fluig/launch/sync-status`
- `POST /fluig/launch/sync-values`

Endpoint interno ja criado no ADM:

- `GET|POST /api/fluig/adm/sync?module=pagamentos|compras|manutencao|fornecedores`

Esse endpoint hoje retorna o contrato local mapeado. Quando o backend Fluig estiver conectado por `FLUIG_API_BASE_URL`, ele pode virar proxy/controlador real mantendo a mesma interface das paginas.

## Backend operacional implementado

O ADM agora possui um adaptador server-side para consultar o Fluig real usando o runner do projeto `FLUIG_WEB_AUTOMATION_NEXUS`.

Configuracao local:

- `FLUIG_INTEGRATION_MODE=direct_runner`
- `FLUIG_DIRECT_RUNNER_ROOT=D:\PROJETOS\FLUIG_WEB_AUTOMATION_NEXUS`
- `FLUIG_TASK_USER_ID=00130`
- `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` para persistir no banco.

Rotas novas:

- `GET /api/fluig/adm/map`: retorna o mapa completo por aba e, com `?persist=true`, grava em `fluig_process_mappings`.
- `POST /api/fluig/adm/history`: consulta historico real por modulo, gera candidatos de fornecedor e grava em `fluig_requests`/`fluig_supplier_candidates` quando Supabase estiver configurado.
- `POST /api/fluig/adm/status`: consulta etapa, responsavel, SLA, vencimento e cancelabilidade por numero Fluig.
- `POST /api/fluig/adm/open`: abre solicitacao a partir de `sourceRequestId`. Sem `confirm=true`, executa apenas dry-run. Em `mode=test`, abre e cancela em seguida; em `mode=production`, mantem aberta.
- `POST /api/fluig/adm/cancel`: cancela solicitacoes informadas. Sem `confirm=true`, executa apenas dry-run.
- `POST /api/fluig/adm/suppliers/preload`: varre historico e cria pre-cadastro de fornecedores por CNPJ/nome normalizado.

Scripts locais usados pelo adaptador:

- `scripts/fluig-adm-query-history.cjs`: consulta generica de historico por `processId` e versoes.
- `scripts/fluig-adm-open-from-source.cjs`: abre nova solicitacao clonando uma solicitacao modelo e sobrescrevendo campos.

Validacoes executadas em 17/06/2026:

- `GET /api/fluig/adm/map`: runner detectado em modo `direct_runner`.
- `POST /api/fluig/adm/status` para `1103651` e `1103369`: consulta real funcionou, retornando etapa `Realizar Pagamento`, responsavel `Administrativo CD`, vencimento `18/03/2026`, processo finalizado e nao cancelavel.
- `POST /api/fluig/adm/history` com `module=pagamentos`, `pageSize=10`, `maxPages=1`: consultou 10 solicitacoes reais recentes.
- `POST /api/fluig/adm/suppliers/preload` com `module=pagamentos`, `pageSize=5`, `maxPages=1`: encontrou 1 candidato de fornecedor.

Persistencia:

- Migracao: `supabase/migrations/20260617123000_fluig_operational_mapping.sql`.
- Tabelas: `fluig_process_mappings`, `fluig_requests`, `fluig_request_events`, `fluig_operation_runs`, `fluig_supplier_candidates`, `fluig_supplier_links`.
- RLS ativo em todas as tabelas e grants explicitos para `authenticated`.

Comandos seguros de teste:

```powershell
$body = @{ module='pagamentos'; requestIds=@('1103651','1103369'); persist=$false } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/fluig/adm/status' -Method Post -ContentType 'application/json' -Body $body
```

```powershell
$body = @{ module='pagamentos'; days=30; pageSize=10; maxPages=1; persist=$false } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/fluig/adm/history' -Method Post -ContentType 'application/json' -Body $body
```

```powershell
$body = @{ module='pagamentos'; fieldOverrides=@{ nNotaFiscal='TESTE-DRYRUN' } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/fluig/adm/open' -Method Post -ContentType 'application/json' -Body $body
```

## Proximas etapas tecnicas

- Implementar chamadas reais de abertura por modulo: pagamento, compra e manutencao.
- Persistir numero Fluig, etapa atual, responsavel, SLA, valor fiscal e `NumLancW` nas tabelas do ADM.
- Salvar mapa de fornecedor no cadastro local para evitar erro nos zooms `fornecedorC` e `codCNPJ`.
- Criar sincronizacao agendada para tarefas abertas sob responsabilidade do usuario/grupo Fluig.
- Validar anexos XML/PDF antes de enviar para o Fluig.
