# Supabase

Base prevista para o MVP do MaxControLADM.

## Variáveis

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`

## Storage

- Bucket: `cd-anexos`
- Tipos planejados: PDF, PNG, JPG, JPEG e WEBP.

## Próxima etapa técnica

Criar migrations para `cds`, `profiles`, `fornecedores`, `produtos`, `contratos`, `despesas`, `pagamentos`, `requisicoes_compra`, `cotacoes`, `ordens_servico`, `tarefas`, `checklist_templates`, `checklist_execucoes`, `notificacoes`, `anexos`, `auditoria`, `categorias`, `centros_custo` e `configuracoes`.

## Migracao Fluig operacional

Arquivo criado:

- `supabase/migrations/20260617123000_fluig_operational_mapping.sql`

Tabelas:

- `fluig_process_mappings`: mapa tecnico por aba/processo.
- `fluig_requests`: solicitacoes consultadas, abertas, sincronizadas ou canceladas.
- `fluig_request_events`: trilha de eventos por solicitacao.
- `fluig_operation_runs`: auditoria de dry-run, consulta, abertura e cancelamento.
- `fluig_supplier_candidates`: pre-cadastro de fornecedores detectados no historico.
- `fluig_supplier_links`: vinculo revisado entre candidato, fornecedor ADM e fornecedor Fluig.

Seguranca:

- RLS habilitado em todas as tabelas no schema `public`.
- Grants explicitos para `authenticated`; nenhuma permissao foi concedida para `anon`.
- As rotas server-side usam `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor e fazem lazy initialization para nao quebrar `next build`.
