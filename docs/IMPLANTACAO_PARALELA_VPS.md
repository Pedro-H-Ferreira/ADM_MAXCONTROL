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

Em 17/07/2026, a rota IPv4 direta da VPS para
`nossaempresa.fluig.cloudtotvs.com.br:443` terminou em timeout antes do TLS,
embora o mesmo endereco respondesse normalmente fora da VPS. O runner da
homologacao usa `FLUIG_PROXY_URL` para aplicar um proxy apenas ao Chromium do
Playwright; a aplicacao, o banco e os demais containers continuam na rota
normal da VPS.

No host, o cliente WARP opera em modo proxy SOCKS local em
`127.0.0.1:40000`. O servico `warp-socks-relay.service` publica esse socket
somente no gateway privado da rede Docker Coolify, em `172.16.1.1:40001`.
Configure no recurso Coolify:

```dotenv
FLUIG_PROXY_URL=socks5://172.16.1.1:40001
```

Se a rede `coolify` for recriada com outro gateway, atualize o bind do servico
e a variavel antes de executar o runner. O ambiente original deve continuar
ativo ate os testes de leitura e de abertura controlada serem aprovados.

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
