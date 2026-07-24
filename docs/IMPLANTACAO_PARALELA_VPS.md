# Implantacao definitiva na VPS

O ADM MaxControl opera na VPS pelo Coolify. A aplicacao, o Supabase
self-hosted e o executor Fluig ficam na mesma infraestrutura; Vercel e
Supabase gerenciado nao fazem parte do runtime atual.

## Enderecos e origem do deploy

| Recurso | Endereco |
| --- | --- |
| Aplicacao | `https://portal-homolog.nexusmax.cloud` |
| Supabase self-hosted | `https://supabase-portal.nexusmax.cloud` |
| Repositorio | `Pedro-H-Ferreira/ADM_MAXCONTROL` |
| Branch do Coolify | `codex/vps-parallel-pilot` |

O recurso do Coolify usa GitHub App e Dockerfile. Cada push na branch
configurada dispara o build, o health check em `/api/health` e a troca do
container somente depois de o novo container ficar saudavel.

## Executor Fluig interno

Configure `FLUIG_INTEGRATION_MODE=internal_runner` e
`FLUIG_SERVER_WORKER_ENABLED=true`. O worker iniciado pelo servidor Next.js
consome `fluig_jobs` sequencialmente, executa os scripts em `scripts/fluig` com
o Chromium do container e persiste o resultado usando a mesma camada de
negocio das rotas historicas.

Nao instale nem pareie o antigo agente Windows. As tabelas e rotas antigas
permanecem apenas para compatibilidade e auditoria de jobs anteriores.

## Credenciais por usuario

O administrador informa `Usuario Fluig` e `Senha Fluig` em `Usuarios e
Perfis`. A senha:

- e criptografada com AES-256-GCM antes de ser gravada;
- usa AAD vinculado ao UUID do usuario, impedindo mover o ciphertext entre
  perfis;
- nunca volta nas respostas da API;
- pode ser mantida deixando o campo em branco ou removida explicitamente;
- e lida somente pelo backend com `service_role`.

A chave `FLUIG_CREDENTIALS_ENCRYPTION_KEY` deve ter 32 bytes em base64 ou 64
caracteres hexadecimais, existir apenas como secret do Coolify e permanecer
estavel entre deploys. Nao use `FLUIG_USERNAME` ou `FLUIG_PASSWORD` globais.

## Rede ate o Fluig

A rota direta da VPS ate o Fluig apresentou timeout antes do TLS. O servico
WARP do host publica um proxy SOCKS somente no gateway privado da rede Docker:

```dotenv
FLUIG_PROXY_URL=socks5://172.16.1.1:40001
```

Esse proxy e aplicado apenas ao Chromium do executor. Aplicacao, Supabase e
demais containers continuam usando a rota normal da VPS. Se a rede `coolify`
for recriada, valide o gateway e o servico `warp-socks-relay.service` antes de
executar tarefas Fluig.

## Banco self-hosted

As migrations ficam em `supabase/migrations`. Antes de aplicar uma migration
manualmente, crie backup no host e execute o SQL com `ON_ERROR_STOP=1`. A
migration `20260721192657_fluig_user_credentials.sql` adiciona o cofre de
credenciais e as RPCs exclusivas do executor da VPS.

O banco validado na migracao possuia 61 tabelas publicas com RLS, 2 usuarios
de Auth, 3 perfis, 956 fornecedores e 12.748 solicitacoes Fluig. Storage e
Auth tambem sao componentes do Supabase self-hosted e precisam entrar no plano
de backup junto com o Postgres.

## Variaveis obrigatorias no Coolify

```dotenv
NEXT_PUBLIC_APP_URL=https://portal-homolog.nexusmax.cloud
NEXT_PUBLIC_SUPABASE_URL=https://supabase-portal.nexusmax.cloud
SUPABASE_URL=https://supabase-portal.nexusmax.cloud
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
FLUIG_INTEGRATION_MODE=internal_runner
FLUIG_SERVER_WORKER_ENABLED=true
FLUIG_SERVER_WORKER_POLL_MS=2500
FLUIG_CREDENTIALS_ENCRYPTION_KEY=...
FLUIG_RUNTIME_DATA_DIR=/app/.adm-fluig-runtime
FLUIG_BASE_URL=...
FLUIG_PROXY_URL=socks5://172.16.1.1:40001
```

Seletores e caminhos Fluig continuam configurados no Coolify. Segredos nunca
devem ser gravados no Git, em tickets ou em logs.

## Validacao e rollback

Depois de cada deploy:

1. confirmar `/api/health` e o estado `healthy` do container;
2. autenticar no portal usando o Supabase da VPS;
3. executar `Testar conexao Fluig` com um usuario que possua credencial;
4. conferir os eventos e o resultado do job no banco;
5. fazer abertura ou cancelamento somente com confirmacao e caso controlado.

O rollback de aplicacao e feito pelo deployment anterior do Coolify. Mudancas
de banco exigem restauracao do backup correspondente; por isso migrations
destrutivas nao devem ser aplicadas sem janela e teste de restauracao.
