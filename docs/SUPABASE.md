# Supabase

Base prevista para o MVP do MaxControLADM.

Projeto usado:

- Nome: `PORTAL ADM CD`
- Ref: `asdxkkduejwibpojychi`
- URL: `https://asdxkkduejwibpojychi.supabase.co`
- Regiao: `sa-east-1`

Observacao operacional:

- O projeto novo `ADM MaxControl` (`iyhvzaduwwbhzrlfangx`) foi criado por engano e nao deve ser usado.
- A tentativa de pausar pelo conector Supabase falhou porque o projeto nao esta em free-tier; ele precisa ser excluido ou rebaixado manualmente no dashboard Supabase.

## Variaveis

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`

## Storage

- Bucket: `cd-anexos`
- Tipos planejados: PDF, PNG, JPG, JPEG e WEBP.

## Proxima etapa tecnica

Criar migrations para `cds`, `profiles`, `fornecedores`, `produtos`, `contratos`, `despesas`, `pagamentos`, `requisicoes_compra`, `cotacoes`, `ordens_servico`, `tarefas`, `checklist_templates`, `checklist_execucoes`, `notificacoes`, `anexos`, `auditoria`, `categorias`, `centros_custo` e `configuracoes`.

## Migracao Fluig operacional

Arquivo criado:

- `supabase/migrations/20260617123000_fluig_operational_mapping.sql`
- `supabase/migrations/20260617213500_tighten_fluig_rls_policies.sql`
- `supabase/migrations/20260617214000_add_fluig_fk_indexes.sql`

Tabelas:

- `fluig_process_mappings`: mapa tecnico por aba/processo.
- `fluig_requests`: solicitacoes consultadas, abertas, sincronizadas ou canceladas.
- `fluig_request_events`: trilha de eventos por solicitacao.
- `fluig_operation_runs`: auditoria de dry-run, consulta, abertura e cancelamento.
- `fluig_supplier_candidates`: pre-cadastro de fornecedores detectados no historico.
- `fluig_supplier_links`: vinculo revisado entre candidato, fornecedor ADM e fornecedor Fluig.

Seguranca:

- RLS habilitado em todas as tabelas no schema `public`.
- Leitura liberada para `authenticated`; escrita revogada para `authenticated` e feita pelas rotas server-side via `service_role`.
- Nenhuma permissao foi concedida para `anon`.
- As rotas server-side usam `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor e fazem lazy initialization para nao quebrar `next build`.

Status aplicado no Supabase:

- Migracoes aplicadas com sucesso no projeto `PORTAL ADM CD`.
- Advisor de seguranca sem alertas de RLS permissivo; permanece apenas aviso global de leaked password protection desabilitado no Auth.
- Advisor de performance mostra indices ainda nao usados porque as tabelas Fluig estao vazias.

Pendencia de ambiente:

- `SUPABASE_SERVICE_ROLE_KEY` precisa ser configurada no Vercel para as rotas gravarem em `fluig_*`.
- O conector Supabase forneceu a URL e publishable key, mas nao expoe a service role key.
