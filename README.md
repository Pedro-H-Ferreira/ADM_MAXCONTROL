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
npm run lint
npm run build
```

## Próximas etapas

1. Criar migrations Supabase.
2. Ligar Supabase Auth ao `/login`.
3. Substituir dados de desenvolvimento por queries reais filtradas por `cd_id`.
4. Implementar CRUDs com Server Actions e RLS.
