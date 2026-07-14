# Auditoria tecnica e operacional - 13/07/2026

## Resumo executivo

Esta entrega corrige os gargalos de navegacao e sincronizacao do Fluig, substitui
o cadastro simples de manutencao por um dominio operacional normalizado e adiciona
validacao automatizada para os principais tamanhos de tela e meios de entrada.

O resultado medido na pagina de pagamentos foi:

| Metrica | Antes | Depois | Variacao |
| --- | ---: | ---: | ---: |
| Chamadas iniciais de API | 11 | 5 | -54,5% |
| `responseStart` | 358 ms | 111 ms | -69,0% |
| `load` | 704 ms | 216 ms | -69,3% |
| Estabilizacao de rede | 13,46 s | 1,12 s | -91,7% |
| Sincronizacao `POST` ao abrir | 1 | 0 | eliminada |

O baseline foi executado em um worktree isolado no commit `d1e1018`, com a mesma
sessao e o mesmo banco utilizados na medicao final.

## Problemas e correcoes

| Problema | Causa | Impacto | Correcao | Evidencia |
| --- | --- | --- | --- | --- |
| Rolagem vertical inconsistente | Mais de um dono do scroll entre documento, shell, tabelas e overlays | Telas travavam principalmente em toque e resolucoes menores | Documento passou a ser o dono do scroll; menu lateral ficou independente; dialogs e sheets mantem bloqueio apenas enquanto abertos | Suite Playwright em 17 rotas e 5 viewports |
| Tela de tarefas travava no toque | Tabela larga permanecia no compositor mobile | Gesto vertical podia ser capturado pela tabela | Cartoes abaixo de `lg`, tabela somente em desktop e paginacao de 10 itens | Testes touch em 360, 390 e 768 px |
| Chamadas duplicadas do Fluig | Pai e filhos consultavam os mesmos recursos; pagina disparava sync ao montar | Carga repetida, logins extras e espera de ate 17 s | Leitura consolidada, sync apenas por comando do usuario e resumo operacional paginado | 11 chamadas antes, 5 depois |
| Historico de 730 dias no fluxo comum | Consulta historica estava acoplada a abertura da tela | Alto volume de dados e processamento desnecessario | Historico longo ficou restrito a acao avancada de administrador com confirmacao | Nenhuma chamada historica na abertura final |
| Polling concorrente | Cada componente mantinha seu proprio ciclo | Requisicoes repetidas e atualizacoes fora de ordem | Estado compartilhado com deduplicacao, `AbortController`, pausa em aba oculta e backoff 2/5/10/15 s | Testes unitarios do hook e teste de rede |
| Listagem de jobs carregava payload tecnico | Endpoint retornava dados maiores que o painel precisava | Transferencia e serializacao desnecessarias | Resumo leve, limite de 200 ativos e detalhe sob demanda | Endpoint operacional testado |
| Consultas operacionais sem cobertura adequada | Filtros frequentes nao tinham indices dedicados | Leitura mais lenta conforme o historico cresce | Indices para filtros do Fluig e todas as FKs de manutencao | Advisor sem FK nao indexada apos migracao |
| Manutencao sem dominio operacional | Dados estavam concentrados em uma estrutura simples | Sem estoque transacional, inventario ou preventivas confiaveis | Tabelas normalizadas, repositorio com escopo de filial e APIs funcionais | Testes de reserva, consumo, devolucao, aprovacao e encerramento |

## Entregas funcionais

### Shell e navegacao

- Scroll vertical pelo documento em todas as rotas.
- Sidebar fixa, retratil e independente do conteudo.
- Drawer mobile e overlays com bloqueio de fundo apenas durante a interacao.
- Layout adaptado para mouse, teclado, trackpad e toque.
- Estado de carregamento e paginas de erro sem quebrar o shell.

### Integracao Fluig

- Listagem resumida e paginada no servidor em
  `/api/fluig/adm/requests`.
- Filtros de texto, status, filial, abertos, atrasados e erros executados no
  servidor.
- Paginas de 20, 50 ou 100 registros e busca com debounce de 350 ms.
- Drawer de detalhe e painel tecnico carregados somente quando solicitados.
- Polling compartilhado, com encerramento em estado terminal e timeout.
- Sincronizacao historica extensa isolada em acao administrativa avancada.

Na abertura final de `/pagamentos`, cada rota abaixo foi chamada uma unica vez:

1. `GET /api/agent/pair`
2. `GET /api/fluig/adm/tasks/my?limit=40&module=pagamentos`
3. `GET /api/fluig/adm/requests?module=pagamentos&page=1&pageSize=50&open=true`
4. `GET /api/fluig/adm/sync/state?module=pagamentos`
5. `GET /api/fluig/adm/jobs?limit=50`

### Manutencao

- Dashboard e workspace operacional.
- Ordens de servico com escopo por filial e fluxo de aprovacao.
- Ativos, localizacao, condicao, transferencias e baixa.
- Materiais, estoque, movimentos e ajuste com permissao de almoxarifado.
- Reserva, consumo e devolucao vinculados a OS.
- Inventarios de materiais e ativos com referencia congelada, encontrado/nao
  encontrado e aprovacao.
- Planos preventivos, calendario, fornecedores, relatorios e configuracoes.
- Encerramento transacional de OS com validacao das pendencias.
- Permissoes de pagina e de acao verificadas no servidor, alem do escopo de
  filial aplicado nas consultas.

## Banco e seguranca

As migracoes de manutencao e Fluig foram aplicadas no projeto Supabase
`PORTAL ADM CD` (`asdxkkduejwibpojychi`).

Resultado do advisor depois das migracoes:

- Chaves estrangeiras sem indice de cobertura: **0**.
- Avisos de indice nao utilizado: 127. Os indices novos aparecem nessa categoria
  porque ainda nao possuem historico de uso; nao devem ser removidos agora.
- `fluig_supplier_links` permanece com RLS e sem policy para usuarios comuns por
  ser uma tabela de uso exclusivo do service role.
- A extensao legada `unaccent` ainda esta no schema `public`; mover exige uma
  migracao separada com auditoria de dependencias.
- Protecao contra senhas vazadas precisa ser ativada no painel do Supabase Auth.
- O percentual fixo de conexoes do Auth deve ser revisto antes de aumento de
  escala.

## Validacao executada

| Validacao | Resultado |
| --- | --- |
| ESLint | aprovado |
| TypeScript | aprovado |
| Testes unitarios e de contrato | 194 aprovados em 33 arquivos |
| Build Next.js 16.2.9 | aprovado |
| Playwright | 100 aprovados, 10 condicionais ignorados |
| Rotas do menu | 17 rotas verificadas |
| Viewports | 360, 390, 768, 1366 e 1920 px |
| Entradas | toque, mouse, teclado e trackpad |
| Erros de console nas medicoes finais | nenhum |

Medicoes locais com build de producao:

| Rota | `responseStart` | `load` | APIs iniciais |
| --- | ---: | ---: | ---: |
| `/dashboard` | 121 ms | 260 ms | 6 |
| `/pagamentos` | 111 ms | 216 ms | 5 |
| `/manutencao` | 201 ms | 295 ms | 1 |

## Pendencias declaradas

Os itens abaixo devem ser tratados em uma proxima entrega e nao sao considerados
concluidos por esta auditoria:

1. Importacao de ativos por planilha com pre-visualizacao, validacao linha a linha
   e confirmacao antes da gravacao.
2. Leitura de QR code pela camera do celular; o identificador e o valor de QR ja
   existem no dominio, mas o scanner de camera ainda nao foi implementado.
3. Expansao do dashboard para o conjunto completo de indicadores gerenciais
   solicitado, com definicao formal de formula, periodo e meta por KPI.
4. Ampliacao dos testes E2E de CRUD para cada submodulo de manutencao. Os fluxos
   transacionais criticos e as APIs ja possuem cobertura automatizada.
5. Migracao controlada do `unaccent`, ativacao de senha vazada e ajuste de conexoes
   do Auth no painel do Supabase.

## Publicacao

O commit funcional `149558d` foi publicado na branch
`codex/technical-audit-maintenance-fluig` e implantado em producao pela Vercel.

- Deployment: `dpl_4EKCZCdcv84tcKGZdy3BQR4WCYFF`.
- Estado da Vercel: `READY`.
- Alias publico: `https://adm-maxcontrol.vercel.app`.
- Build remoto: Next.js 16.2.9 compilado, TypeScript aprovado e 36 paginas
  estaticas geradas.
- Smoke autenticado em producao: dashboard, pagamentos e os dez submodulos de
  manutencao aprovados.
- Rede em producao: os cinco recursos iniciais do Fluig foram chamados uma vez,
  sem sincronizacao historica ou `POST /api/fluig/adm/sync` na abertura.
