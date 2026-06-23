# ADM Fluig Agent local

O portal ADM roda na Vercel, mas a automacao do Fluig roda na maquina Windows de cada usuario.

## Fluxo

1. O usuario abre uma pagina do ADM e clica em uma acao Fluig.
2. A Vercel cria um registro em `fluig_jobs`.
3. O `ADM Fluig Agent` instalado na maquina do usuario faz polling da fila.
4. O agente abre o Fluig em background com Playwright, usando as credenciais locais do usuario.
5. O agente envia eventos para `fluig_job_events` e o resultado para a API.
6. A API persiste os dados em `fluig_requests` e a tela atualiza o status.

## Como cada tela sincroniza

- `/pagamentos`: cria job `sync_initial_history` ou `sync_history` do modulo `pagamentos`; o agente consulta o processo Central de Lancamento e grava pagamentos, fornecedores, filiais, naturezas, centros de custo e modelos mensais.
- `/compras`: cria job historico do modulo `compras`; o agente consulta o processo de Compra Administrativa e grava requisicoes, modelos, fornecedores e catalogos de compra.
- `/manutencao`: cria job historico do modulo `manutencao`; o agente consulta o processo de ativo fixo/manutencao e grava OS Fluig, retornos e catalogos da manutencao.
- `/fornecedores`: cria um unico job `sync_initial_history` do modulo `fornecedores`, mas o payload contem os processos reais de pagamentos, compras e manutencao. O agente faz um login, percorre todos os processos na mesma sessao e cada item volta com `moduleSlug` para ser salvo no modulo correto.
- Dashboard / botao `Sincronizar meu Fluig`: cria um unico job `sync_user_incremental_batch`. O payload contem lotes internos por modulo e tipo (`open_tasks` e `my_requests`). O agente abre uma sessao, consulta todos os numeros Fluig conhecidos uma vez e o backend grava cada item no modulo correto.
- Endpoints especificos `/api/fluig/adm/sync/open-tasks` e `/api/fluig/adm/sync/my-requests`: continuam criando jobs separados quando for necessario diagnosticar ou executar somente uma parte da sincronizacao.
- Consulta de status por numero Fluig: cria `sync_request_by_number`; o agente faz uma sessao e consulta todos os numeros enviados no mesmo job.
- Abertura/cancelamento: criam `open_from_source` ou `cancel_request`; cada job usa a sessao do usuario local e devolve protocolo/status para a tela.
- Em `/manutencao`, `open_from_source` tambem carrega `maintenanceOrderId`; ao receber o resultado, a API atualiza `app_maintenance_orders` com numero Fluig, etapa, responsavel, `NumLancW` quando existir, e evento de auditoria.

## Controle contra jobs duplicados

As rotas de sincronizacao reaproveitam um job ativo equivalente antes de inserir outro registro em `fluig_jobs`.

O reaproveitamento considera:

- mesmo usuario do ADM;
- mesmo modulo;
- mesma operacao;
- mesma filial resolvida;
- mesmo payload normalizado;
- job ainda ativo e nao expirado.

Isso vale para:

- `sync_history`;
- `sync_initial_history`;
- `sync_status`;
- `sync_user_open_tasks`;
- `sync_user_open_requests`;
- `sync_user_incremental_batch`;
- `sync_request_by_number`;
- `supplier_lookup_by_cnpj`.

Nao vale para `open_from_source` e `cancel_request`, porque repetir essas operacoes pode representar uma acao intencional do usuario.

## Reuso de login

O agente nao deve logar novamente para cada pagina ou item dentro do mesmo job. A regra atual e:

- cada job abre no maximo uma sessao Playwright;
- dentro de `sync_history`, a mesma pagina consulta todas as janelas, paginas e processos do payload;
- dentro de `sync_status`, a mesma pagina consulta todos os numeros Fluig do payload;
- dentro de `sync_user_incremental_batch`, a mesma pagina consulta todos os numeros abertos conhecidos do usuario, mesmo quando eles pertencem a modulos/tipos diferentes;
- a sessao autenticada fica salva em `%APPDATA%\ADM MaxControl\fluig-agent\auth\fluig.json`, isolada por usuario Windows;
- o trace fica em `%APPDATA%\ADM MaxControl\fluig-agent\logs\session-trace.log` e mostra `Sessao reutilizada valida: sim` quando o cache foi aceito.

Se aparecer login repetido, conferir primeiro o `session-trace.log`. Quando ele mostra `Sessao reutilizada valida: nao`, o Fluig invalidou o cookie ou a URL base/login esta incorreta.

## Envio de resultados grandes

Historicos grandes, principalmente `/fornecedores`, nao sao enviados em um unico POST. O agente `0.1.1` divide o retorno em lotes adaptativos:

- limite padrao de 25 registros por lote;
- limite padrao de aproximadamente 650 KB por POST;
- campos `raw` redundantes do Fluig sao compactados antes do envio;
- valores muito grandes de campos do formulario sao truncados para evitar `HTTP 413`;
- a API grava cada lote em `/api/agent/jobs/[jobId]/chunk` e o fechamento do job envia apenas um resumo.

Variaveis opcionais para diagnostico fino na maquina do usuario:

```text
ADM_FLUIG_HISTORY_CHUNK_ITEMS=25
ADM_FLUIG_HISTORY_CHUNK_BYTES=650000
ADM_FLUIG_HISTORY_FIELD_MAX_CHARS=6000
ADM_FLUIG_HISTORY_AGGRESSIVE_FIELD_MAX_CHARS=1000
```

Se ainda ocorrer `Falha HTTP 413`, confira no `/health` local se `agentVersion` esta em `0.1.1` ou superior. Versoes anteriores podem tentar enviar resultados grandes pelo endpoint final.

## Seguranca

- A senha do Fluig nao fica na Vercel nem no Supabase.
- A senha e salva localmente em `%APPDATA%\ADM MaxControl\fluig-agent\fluig-credential.json`.
- O valor fica criptografado pelo DPAPI do Windows para o usuario logado.
- O agente autentica na Vercel com um token proprio, salvo em `config.json`.
- O agente escuta apenas em `127.0.0.1`.

## Instalar em uma maquina de usuario

1. No ADM, abrir `Usuarios e Perfis` e conferir o usuario/filiais.
2. Em qualquer painel Fluig, clicar em `Parear agente`.
3. Copiar o token exibido uma unica vez.
4. Na maquina do usuario, executar com duplo clique:

```text
INSTALAR-AGENTE-FLUIG.bat
```

O instalador vai pedir o token, a URL base do Fluig, usuario e senha.

Alternativa tecnica, se precisar passar parametros manualmente:

```powershell
powershell -ExecutionPolicy Bypass -File .\agent\fluig-agent\scripts\install-windows-agent.ps1 `
  -AgentToken "TOKEN_GERADO_NO_ADM" `
  -FluigBaseUrl "https://SEU_FLUIG"
```

O instalador:

- grava `%APPDATA%\ADM MaxControl\fluig-agent\config.json`;
- pede usuario e senha do Fluig;
- salva a senha com DPAPI;
- instala Chromium do Playwright;
- cria a tarefa agendada `ADM MaxControl Fluig Agent`;
- inicia o agente.

## Verificar

```powershell
Invoke-RestMethod http://127.0.0.1:4777/health
```

Na tela do ADM, o agente deve aparecer como `ONLINE` depois do primeiro heartbeat. O `/health` tambem mostra `agentVersion`, `lastHeartbeatAt`, `lastPollAt`, `lastSuccessfulApiAt` e `lastError` para diagnosticar agente antigo, falha de rede ou erro de polling.

Tambem e possivel conferir pelo duplo clique:

```text
VERIFICAR-AGENTE-FLUIG.bat
```

## Remover

Com duplo clique:

```text
REMOVER-AGENTE-FLUIG.bat
```

Ou via PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\agent\fluig-agent\scripts\uninstall-windows-agent.ps1
```

Para remover tambem a configuracao local:

```powershell
powershell -ExecutionPolicy Bypass -File .\agent\fluig-agent\scripts\uninstall-windows-agent.ps1 -RemoveLocalConfig
```

## Filiais

As filiais ficam em `app_branches`. O vinculo por usuario fica em `app_user_branch_access`.

Admin (`ADMIN_MASTER` ou `ADMIN`) ve todas as filiais. Os demais usuarios veem:

- solicitacoes da filial marcada no cadastro do usuario;
- solicitacoes criadas pelo proprio usuario no ADM;
- solicitacoes cujo solicitante Fluig corresponde ao `fluig_username` do perfil.
