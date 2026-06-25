# Integracao Fluig no ADM MaxControL

## Decisao de produto

A integracao Fluig nao sera uma aba operacional separada. O ADM possui seu proprio runner/API server-side para autenticar, consultar e operar o Fluig; cada fluxo fica dentro da pagina natural do ERP:

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

## Runner Fluig do ADM

O ADM nao depende de runner externo em runtime. Os modulos necessarios de autenticacao e API do Fluig ficam dentro de `scripts/fluig` neste repositorio.

O ADM nao importa a fila antiga nem o modelo antigo de lancamentos. Ele usa os contratos tecnicos internos apenas para:

- consultar historico e status;
- abrir solicitacao a partir de modelo real;
- cancelar solicitacoes confirmadas;
- mapear fornecedores ja usados.

## API operacional

Endpoints tecnicos internos:

- `GET /fluig/suppliers`
- `GET /fluig/logs`
- `POST /fluig/launch/sync-status`
- `POST /fluig/launch/sync-values`

Endpoint interno ja criado no ADM:

- `GET|POST /api/fluig/adm/sync?module=pagamentos|compras|manutencao|fornecedores`

Esse endpoint le o snapshot persistido no Supabase e mostra os dados nas paginas do ADM.

## Backend operacional implementado

O ADM agora possui um adaptador server-side para consultar o Fluig real usando seu runner interno em `scripts/fluig`.

Configuracao local:

- `FLUIG_INTEGRATION_MODE=internal_runner`
- `FLUIG_BASE_URL`, `FLUIG_USERNAME`, `FLUIG_PASSWORD` e seletores de login/formulario no `.env.local`.
- `FLUIG_TASK_USER_ID=00130`
- `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` para persistir no banco.

Rotas novas:

- `GET /api/fluig/adm/map`: retorna o mapa completo por aba e, com `?persist=true`, grava em `fluig_process_mappings`.
- `POST /api/fluig/adm/history`: consulta historico real por modulo, gera candidatos de fornecedor e grava em `fluig_requests`/`fluig_supplier_candidates` quando Supabase estiver configurado.
- `POST /api/fluig/adm/sync/historical`: cria jobs de carga historica inicial pelo agente local. Para `fornecedores`, agenda pagamentos, compras e manutencao.
- `POST /api/fluig/adm/sync/user`: cria um job incremental em lote (`sync_user_incremental_batch`) para o usuario logado, agrupando tarefas e solicitacoes abertas conhecidas em uma unica execucao do agente, sem varrer historico completo.
- `POST /api/fluig/adm/sync/open-tasks`: cria job incremental `sync_user_open_tasks` para consultar status Fluig somente de solicitacoes abertas conhecidas.
- `POST /api/fluig/adm/sync/my-requests`: cria job incremental `sync_user_open_requests` para consultar status Fluig somente de solicitacoes abertas conhecidas.
- `GET /api/fluig/adm/sync/state`: retorna `lastSync`, `lastSuccess` e `lastError` por usuario, modulo e tipo de sync.
- `GET /api/fluig/adm/tasks/my`: lista tarefas Fluig conhecidas do usuario a partir do snapshot persistido e filtrado por permissao.
- `GET /api/fluig/adm/requests/my-open`: lista solicitacoes abertas conhecidas do usuario a partir do snapshot persistido e filtrado por permissao.
- `POST /api/fluig/adm/request/lookup`: cria job de consulta sob demanda por numero Fluig, persistindo o status quando o agente retorna.
- `GET /api/fluig/adm/request/lookup?fluigRequestId=1103651&module=pagamentos`: le o ultimo snapshot persistido do numero Fluig, inclusive quando a solicitacao ja esta finalizada e nao deve voltar para as listas de abertas.
- `POST /api/fluig/adm/status`: consulta etapa, responsavel, SLA, vencimento e cancelabilidade por numero Fluig.
- `POST /api/fluig/adm/open`: abre solicitacao a partir de `sourceRequestId`. Sem `confirm=true`, executa apenas dry-run. Em `mode=test`, abre e cancela em seguida; em `mode=production`, mantem aberta.
- `POST /api/fluig/adm/cancel`: cancela solicitacoes informadas. Sem `confirm=true`, executa apenas dry-run.
- `POST /api/fluig/adm/suppliers/preload`: varre historico e cria pre-cadastro de fornecedores por CNPJ/nome normalizado.
- `GET|POST /api/manutencao`: lista e cria OS manuais ou integradas ao Fluig.
- `POST /api/manutencao/[id]/fluig/open`: cria job `open_from_source` para uma OS Fluig existente. O payload leva `maintenanceOrderId`; quando o agente finaliza, `/api/agent/jobs/[jobId]/result` grava numero Fluig, `NumLancW`, etapa, responsavel e evento na OS local.

Rotas de cadastro operacional adicionadas:

- `GET|POST /api/fornecedores`: lista fornecedores reais com paginacao/filtros e cria fornecedor oficial.
- `GET|PATCH|DELETE /api/fornecedores/[id]`: consulta, edita e exclui fornecedor. Quando houver vinculos Fluig, a exclusao vira inativacao logica.
- `GET /api/fornecedores/lookup?cnpj=`: valida CNPJ e consulta, nesta ordem, cadastro local, `fluig_supplier_links`, candidatos, catalogos e solicitacoes Fluig. O lookup aceita historicos que perderam zeros a esquerda, identifica a filial mais usada e devolve somente os defaults necessarios (modelo, centro de custo, natureza e forma de pagamento), sem transportar o payload bruto completo para o navegador.
- `POST /api/fornecedores/candidates/[id]/approve`: converte candidato Fluig em fornecedor oficial e cria link Fluig.
- `POST /api/fornecedores/candidates/[id]/ignore`: ignora candidato Fluig.
- `POST /api/fornecedores/reconcile`: materializa candidatos com CNPJ valido como pre-cadastros pendentes, liga solicitacoes existentes e cria vinculos de filial pela frequencia do historico. Restrito a administradores.
- `GET|POST /api/admin/branches`: lista e cria filiais administrativas.
- `GET|PATCH|DELETE /api/admin/branches/[id]`: consulta, edita e exclui filial. Quando houver vinculos, a exclusao vira inativacao logica.

Scripts locais usados pelo adaptador dentro deste repositorio:

- `scripts/fluig-adm-query-history.cjs`: consulta generica de historico por `processId` e versoes.
- `scripts/fluig-adm-open-from-source.cjs`: abre nova solicitacao clonando uma solicitacao modelo e sobrescrevendo campos.
- `scripts/fluig/syncFluigStatus.js`: consulta status, etapa, responsavel e SLA.
- `scripts/fluig/cancelViaApi.js`: cancela solicitacoes quando confirmado.
- `scripts/fluig/api/session.js` e `scripts/fluig/api/workflowViewApi.js`: autenticacao e chamadas autenticadas ao Fluig.

Sincronizacao por usuario:

- O dashboard chama `/api/fluig/adm/sync/user`.
- A API le as solicitacoes abertas conhecidas por modulo e monta lotes internos para `open_tasks` e `my_requests`.
- A API cria um unico job `sync_user_incremental_batch` em `fluig_jobs`.
- Antes de criar o job, a API procura um job ativo equivalente para o mesmo usuario/modulo/operacao/payload. Se encontrar, reaproveita esse job em vez de gerar outra execucao e outro login no agente.
- O agente executa `scripts/fluig/syncFluigStatus.js` uma unica vez com todos os numeros Fluig deduplicados.
- O resultado volta com `moduleSlug` e tipos de sync para que a API salve cada solicitacao no modulo correto e atualize `fluig_user_sync_state` por usuario/modulo/tipo.
- Os endpoints `/sync/open-tasks` e `/sync/my-requests` permanecem para execucoes isoladas e diagnostico.
- A visibilidade e aplicada no Supabase antes de ordenar e limitar os registros. Usuario comum recebe somente registros da filial, criados por ele, sincronizados por ele ou identificados pelos seus dados Fluig; administradores recebem todas as filiais.
- `GET /api/fluig/adm/tasks/my` exige tarefa ou responsavel atual preenchido e nao mistura solicitacoes abertas sem atividade atribuida.
- O status incremental atualiza etapa, responsavel, vencimento e estado aberto/finalizado sem apagar `formFields` e anexos do historico. A resposta mais recente fica em `raw_payload.statusSnapshot`.
- Historicos antigos recuperam solicitante e matricula pelos campos `responsavelEnvio` e `matResponsavelEnvio` quando a API do Fluig nao devolve o solicitante no cabecalho.

Abertura de OS Fluig:

- A OS integrada ao Fluig continua sendo um registro local em `app_maintenance_orders`.
- O usuario informa uma solicitacao modelo real no campo `Solicitacao modelo Fluig`.
- O botao `Abrir no Fluig` chama `/api/manutencao/[id]/fluig/open`, que cria o job para o agente local do usuario.
- O callback do agente atualiza a OS local com protocolo, etapa, responsavel e `NumLancW` quando o Fluig devolver esses campos.

Validacoes executadas em 17/06/2026:

- `GET /api/fluig/adm/map`: runner detectado em modo `internal_runner`.
- `POST /api/fluig/adm/status` para `1103651` e `1103369`: consulta real funcionou, retornando etapa `Realizar Pagamento`, responsavel `Administrativo CD`, vencimento `18/03/2026`, processo finalizado e nao cancelavel.
- `POST /api/fluig/adm/history` com `module=pagamentos`, `pageSize=10`, `maxPages=1`: consultou 10 solicitacoes reais recentes.
- `POST /api/fluig/adm/suppliers/preload` com `module=pagamentos`, `pageSize=5`, `maxPages=1`: encontrou 1 candidato de fornecedor.

Persistencia:

- Migracao: `supabase/migrations/20260617123000_fluig_operational_mapping.sql`.
- Tabelas: `fluig_process_mappings`, `fluig_requests`, `fluig_request_events`, `fluig_operation_runs`, `fluig_supplier_candidates`, `fluig_supplier_links`.
- RLS ativo em todas as tabelas e grants explicitos para `authenticated`.
- Migracao incremental: `supabase/migrations/20260622191847_suppliers_branches_user_sync.sql`.
- Novas tabelas: `app_suppliers`, `app_supplier_contacts`, `app_supplier_branch_links`, `app_supplier_audit_events`, `fluig_user_sync_state`.
- Evolucoes: `app_branches` recebeu campos administrativos; `fluig_requests` recebeu vinculo com fornecedor oficial, status normalizado, flags de aberto/finalizado e dono de sync; `fluig_jobs` passou a aceitar operacoes de sync inicial, consulta por numero e sync por usuario.
- Hardening aplicado: `supabase/migrations/20260622200452_harden_supplier_sync_schema.sql`, com `search_path` fixo em `set_updated_at`, indices para FKs usadas pelos fluxos novos e policies explicitas de bloqueio direto para tabelas operadas somente via service role.
- Reconciliacao historica: `supabase/migrations/20260624090623_reconcile_fluig_supplier_relations.sql`, executada pelo backend com service role para relacionar pre-cadastros, candidatos, solicitacoes e filiais sem expor escrita direta ao cliente.

Estado verificado em `PORTAL ADM CD` em 22/06/2026:

- Data API retorna `200` para `app_suppliers`, `app_supplier_contacts`, `app_supplier_branch_links`, `app_supplier_audit_events`, `fluig_user_sync_state`, `app_branches` e `fluig_jobs`.
- Advisor de seguranca restante: `unaccent` em schema `public` e protecao de senha vazada desativada no Supabase Auth.
- Advisor de performance restante: indices recentes ainda aparecem como `unused_index` porque os fluxos acabaram de ser criados; nao remover sem volume real de uso.

Reconciliacao de fornecedores verificada em `PORTAL ADM CD` em 24/06/2026:

- `956` fornecedores unicos com CNPJ valido foram materializados em `app_suppliers` como `PRE_CADASTRO_FLUIG` e `PENDENTE_REVISAO`.
- `957` candidatos Fluig foram vinculados aos pre-cadastros; dois candidatos historicos representam o mesmo CNPJ canonico.
- `10.009` solicitacoes Fluig foram ligadas ao fornecedor oficial pelo CNPJ canonico, sem divergencia de CNPJ.
- `3.139` vinculos fornecedor-filial foram criados; `955` fornecedores possuem filial historica e nenhum possui mais de uma filial padrao.
- `334` candidatos sem CNPJ validavel permaneceram somente em `fluig_supplier_candidates` para revisao, sem contaminar o cadastro oficial.
- Filiais corrompidas por valores como `[object HTMLInputElement]` ou identificadores internos prefixados foram removidas/normalizadas. O cadastro ficou com `46` filiais, sem codigo historico invalido.
- A reconciliacao e idempotente: uma segunda execucao criou `0` fornecedores e vinculou `0` solicitacoes adicionais.

Identidade e visibilidade Fluig verificadas em `PORTAL ADM CD` em 25/06/2026:

- `12.193` solicitacoes persistidas.
- `12.190` solicitacoes possuem solicitante normalizado.
- `11.792` possuem nome/login do solicitante e `11.711` possuem matricula/codigo Fluig.
- O backfill foi aplicado pela migracao `20260625134829_backfill_fluig_requester_identity.sql`.
- Consultas de dashboard, tarefas, solicitacoes abertas e snapshots aplicam o escopo do usuario antes do `limit`, evitando que registros de outras filiais ocupem a janela de resultados.

Operacao:

- O botao `Atualizar pre-cadastros` em `/fornecedores` executa o backfill completo e e exibido somente para administradores.
- Novos lotes de `sync_history`, `sync_initial_history` e `supplier_lookup_by_cnpj` materializam automaticamente apenas os candidatos afetados pelo lote.
- A aprovacao de um candidato reutiliza o pre-cadastro existente, ativa o fornecedor e altera a origem para `LOCAL_FLUIG`, sem criar CNPJ duplicado.

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

- Operar a automacao real por usuario via `ADM Fluig Agent` local. Instalacao e fluxo em `docs/FLUIG_LOCAL_AGENT.md`.
- Manter o agente online e concluir os jobs enfileirados de cada usuario.
- Preencher `fluig_username` e `fluig_user_id` nos perfis para complementar o escopo por filial com a identidade individual do Fluig.
- Validar em producao uma abertura controlada de pagamento, compra e manutencao com anexos reais e protocolo retornado.
- Evoluir a leitura de atividades do Fluig para preencher tarefa atual, responsavel e SLA de todas as solicitacoes abertas.
- Configurar observabilidade com retencao suficiente para correlacionar digests de erro do Next.js com os logs de runtime da Vercel.
