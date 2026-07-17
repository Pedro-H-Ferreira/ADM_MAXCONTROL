# Implantacao paralela na VPS

Esta branch executa o ADM_MAXCONTROL como ambiente de homologacao na VPS sem
alterar o ambiente atual da Vercel ou o Supabase gerenciado.

## Ambientes

| Papel | Aplicacao | Supabase |
| --- | --- | --- |
| Producao atual | `https://adm-maxcontrol.vercel.app` | projeto gerenciado `asdxkkduejwibpojychi` |
| Homologacao VPS | `https://portal-homolog.nexusmax.cloud` | `https://supabase-portal.nexusmax.cloud` |

As variaveis da Vercel nao devem ser alteradas durante a homologacao. A
aplicacao da VPS recebe suas proprias variaveis no Coolify.

## Runner Fluig

Na VPS, configure `FLUIG_INTEGRATION_MODE=internal_runner`. Os scripts em
`scripts/fluig` e o Chromium do Playwright ficam dentro do mesmo container da
aplicacao, eliminando a dependencia do agente instalado em uma estacao local.

As credenciais `FLUIG_USERNAME` e `FLUIG_PASSWORD` sao segredos exclusivos do
servidor e nunca devem ser salvas no Git.

### Acesso de rede ao Fluig

Em 17/07/2026, a aplicacao e o runner interno ficaram saudaveis, mas a conexao
HTTPS da VPS para `nossaempresa.fluig.cloudtotvs.com.br:443` terminou em timeout.
O mesmo endereco respondeu normalmente fora da VPS. Antes do teste produtivo,
o IP `179.197.78.61` deve ser liberado no firewall ou allowlist do ambiente
Fluig/TOTVS. Ate essa liberacao, mantenha o agente e o ambiente original ativos.

## Banco de homologacao

O script `scripts/migrate-supabase-to-vps.ps1` gera os dumps diretamente na VPS
usando uma credencial temporaria e somente leitura emitida pelo Supabase CLI.
Os arquivos ficam fora do repositorio e devem ser apagados depois da validacao.

O processo de copia nao pausa nem modifica o Supabase gerenciado. Como os dois
bancos passam a divergir depois da copia, qualquer teste que crie, altere ou
cancele processos deve ser executado somente no dominio de homologacao.

Na copia validada em 17/07/2026 havia 61 tabelas publicas com RLS habilitado,
2 usuarios de Auth, 3 perfis, 956 fornecedores e 12.748 solicitacoes Fluig. Os
dumps temporarios foram removidos da VPS depois da conferencia.

## Validacao antes do corte

1. Confirmar Auth, REST, Storage e Realtime no Supabase da VPS.
2. Confirmar login dos usuarios de teste; uma nova autenticacao sera exigida.
3. Conferir contagens e amostras das tabelas operacionais.
4. Validar consultas Fluig em modo somente leitura.
5. Validar abertura produtiva com um caso de teste controlado e confirmacao.
6. Manter a Vercel e o Supabase gerenciado ativos durante todo o aceite.

## Corte e rollback

O corte final sera feito somente depois do aceite, alterando DNS e variaveis do
ambiente oficial. Enquanto isso nao ocorrer, o rollback consiste apenas em
continuar usando `https://adm-maxcontrol.vercel.app`; nenhuma restauracao no
ambiente original e necessaria.
