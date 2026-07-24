# Agente Fluig local descontinuado

O agente Windows deixou de fazer parte da arquitetura de producao em
21/07/2026. O ADM executa as consultas, sincronizacoes, aberturas e
cancelamentos diretamente no container da VPS.

## Fluxo atual

1. O administrador cadastra usuario e senha Fluig em `Usuarios e Perfis`.
2. A acao do usuario cria um registro em `fluig_jobs`.
3. O worker interno da VPS assume um job por vez.
4. O Chromium do container autentica com a credencial criptografada do dono do
   job.
5. Eventos, retorno, protocolo e erros sao persistidos no Supabase self-hosted.
6. A tela acompanha o mesmo job ate o estado terminal.

Nao e necessario gerar token, instalar tarefa agendada, manter computador de
usuario ligado ou abrir a porta local `4777`.

## Compatibilidade historica

O diretorio `agent/fluig-agent`, as rotas `/api/agent/*` e as colunas com nome
`agent` permanecem temporariamente para:

- reutilizar o executor e os contratos de payload ja validados;
- interpretar auditoria e jobs criados antes da migracao;
- permitir rollback de codigo sem alterar dados historicos.

Novas tarefas nao dependem de heartbeat ou pareamento. Elas exigem uma linha
em `fluig_user_credentials` para o usuario solicitante e sao processadas pelas
RPCs `claim_next_fluig_server_job`, `transition_fluig_server_job` e
`complete_fluig_server_job`.

## Seguranca

- A API nunca devolve a senha cadastrada.
- A tabela de credenciais tem RLS e nao concede acesso a `anon` ou
  `authenticated`.
- Username e senha sao cifrados com AES-256-GCM e AAD vinculado ao UUID do
  perfil.
- A chave de cifra existe somente nos secrets do Coolify.
- Cada job usa a credencial do usuario que solicitou a tarefa.
- Jobs de abertura e cancelamento continuam sem retry automatico para evitar
  duplicidade.

Para operacao, deploy e rollback, consulte
`docs/IMPLANTACAO_PARALELA_VPS.md`.
