# Especificação Técnica - Portal Administrativo do CD

## 1. Mapa de Rotas (Frontend)
- `/login`: Autenticação
- `/forgot-password`: Recuperação de senha
- `/onboarding`: Setup inicial
- `/dashboard`: Visão geral operacional/financeira
- `/expenses`: Listagem de despesas
- `/expenses/new`: Cadastro de despesa
- `/expenses/:id`: Detalhes e fluxos de pagamento
- `/contracts`: Gestão de contratos
- `/vendors`: Cadastro de fornecedores
- `/products`: Catálogo de produtos operacional
- `/purchase-requests`: Requisições de compra
- `/quotes`: Cotações e aprovações
- `/work-orders`: Ordens de serviço (Manutenção)
- `/tasks`: Checklists e planos de 90 dias
- `/users`: Gestão de acessos (RBAC)
- `/reports`: Relatórios e exportações
- `/settings`: Configurações do sistema

## 2. Mapa de API (Endpoints REST)
- `POST /auth/login`: Login
- `GET /dashboard/summary`: Dados consolidados do dash
- `GET/POST/PUT /expenses`: CRUD de despesas
- `POST /expenses/:id/pay`: Registrar pagamento
- `GET/POST /contracts`: Gestão de contratos
- `GET/POST /vendors`: Gestão de fornecedores
- `GET/POST /work-orders`: Gestão de manutenção

## 3. Matriz de Permissões (RBAC)
- **ADMIN**: Acesso total.
- **GERENTE_CD**: Operação total do CD, sem gestão global de usuários.
- **FINANCEIRO**: Foco em Despesas, Pagamentos, Contratos e Relatórios.
- **MANUTENCAO**: Foco em OS, Fornecedores técnicos e Checklists.
- **LEITURA**: Visualização em todas as áreas, sem escrita.

## 4. Padrão de Anexos
- Todos os arquivos (NFs, Contratos, Comprovantes) são armazenados via **Link/URL**.
- Interface provê campo de URL com validação e preview rápido.

## 5. Stack Alvo
- Next.js + Tailwind + Cloudflare (D1/Workers/Resend).
