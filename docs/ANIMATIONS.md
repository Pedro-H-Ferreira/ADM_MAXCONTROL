# Animacoes Importadas do Stitch

Origem: `stitch-export/4660020320183620207/screens`.

## Mapeamento

- `fade-in-up`: `stitch-animate-in` e `stitch-animate-in-fast`.
- `slide-in-right`: `stitch-slide-right`.
- `slide-down`: `stitch-slide-down`.
- `popIn`: `stitch-pop-in` e `stitch-pop-in-pulse`.
- `barGrow`: `stitch-bar-grow` e `stitch-bar-grow-x`.
- `grow-down`: `stitch-grow-down`.
- `pulse-slow`: `stitch-pulse-slow`.
- `shimmer`: `stitch-shimmer`.
- drift sutil de fundo: `stitch-subtle-drift`.
- atrasos em cascata: `stitch-delay-50` ate `stitch-delay-1000`.

## Aplicacao Atual

- Cards e metricas: entrada em cascata e hover com elevacao leve.
- Dashboard: barras com crescimento horizontal, alertas com `pop-in`, acoes rapidas em cascata.
- Listagens: filtros, tabela e linhas com entrada escalonada.
- Formularios: secoes e campos com entrada sequencial.
- Detalhes: cards, auditoria e itens principais com entrada progressiva.
- Topbar/login: entrada suave, botoes com scale/hover e foco com sombra.
- Sidebar desktop: recolhida por padrao, expande automaticamente no hover/foco e recolhe ao sair.

As classes respeitam `prefers-reduced-motion: reduce`.
