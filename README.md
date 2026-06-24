# MaxControLADM

Portal administrativo operacional para Centro de Distribuição.

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide React
- Supabase

## Rodar local

```powershell
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Variáveis

Copie `.env.example` para `.env.local` e preencha:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`

## Estrutura inicial

- `src/app/login`: tela de login visual
- `src/app/(app)`: shell administrativo
- `src/components/app`: AppShell, Sidebar, Topbar, tema e menus
- `src/components/shared`: componentes reutilizáveis
- `src/lib/supabase`: clientes Supabase lazy
- `stitch-export/4660020320183620207`: referência exportada do Stitch

## Comandos de validação

```powershell
npm test
npm run lint
npm run typecheck
npm run build
```

Os testes unitários e de contrato cobrem atualmente:

- validação, normalização e formatação de CNPJ;
- lookup histórico de fornecedor, inclusive zeros à esquerda;
- extração de defaults Fluig;
- deduplicação de candidatos de fornecedor;
- idempotência contratual do upsert de solicitações;
- CRUD contratual das rotas de filiais;
- constraint do perfil `ADMINISTRATIVO`.
