# ADM Fluig Agent local

O portal ADM roda na Vercel, mas a automacao do Fluig roda na maquina Windows de cada usuario.

## Fluxo

1. O usuario abre uma pagina do ADM e clica em uma acao Fluig.
2. A Vercel cria um registro em `fluig_jobs`.
3. O `ADM Fluig Agent` instalado na maquina do usuario faz polling da fila.
4. O agente abre o Fluig em background com Playwright, usando as credenciais locais do usuario.
5. O agente envia eventos para `fluig_job_events` e o resultado para a API.
6. A API persiste os dados em `fluig_requests` e a tela atualiza o status.

## Seguranca

- A senha do Fluig nao fica na Vercel nem no Supabase.
- A senha e salva localmente em `%APPDATA%\ADM MaxControl\fluig-agent\fluig-credential.json`.
- O valor fica criptografado pelo DPAPI do Windows para o usuario logado.
- O agente autentica na Vercel com um token proprio, salvo em `config.json`.
- O agente escuta apenas em `127.0.0.1`.

## Instalar em uma maquina de usuario

1. No ADM, abrir `Usuarios e Perfis` e conferir o usuario/filiais.
2. Em qualquer painel Fluig, clicar em `Parear agente`.
3. Copiar o token exibido uma unica vez.
4. Na maquina do usuario, executar com duplo clique:

```text
INSTALAR-AGENTE-FLUIG.bat
```

O instalador vai pedir o token, a URL base do Fluig, usuario e senha.

Alternativa tecnica, se precisar passar parametros manualmente:

```powershell
powershell -ExecutionPolicy Bypass -File .\agent\fluig-agent\scripts\install-windows-agent.ps1 `
  -AgentToken "TOKEN_GERADO_NO_ADM" `
  -FluigBaseUrl "https://SEU_FLUIG"
```

O instalador:

- grava `%APPDATA%\ADM MaxControl\fluig-agent\config.json`;
- pede usuario e senha do Fluig;
- salva a senha com DPAPI;
- instala Chromium do Playwright;
- cria a tarefa agendada `ADM MaxControl Fluig Agent`;
- inicia o agente.

## Verificar

```powershell
Invoke-RestMethod http://127.0.0.1:4777/health
```

Na tela do ADM, o agente deve aparecer como `ONLINE` depois do primeiro heartbeat.

Tambem e possivel conferir pelo duplo clique:

```text
VERIFICAR-AGENTE-FLUIG.bat
```

## Remover

Com duplo clique:

```text
REMOVER-AGENTE-FLUIG.bat
```

Ou via PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\agent\fluig-agent\scripts\uninstall-windows-agent.ps1
```

Para remover tambem a configuracao local:

```powershell
powershell -ExecutionPolicy Bypass -File .\agent\fluig-agent\scripts\uninstall-windows-agent.ps1 -RemoveLocalConfig
```

## Filiais

As filiais ficam em `app_branches`. O vinculo por usuario fica em `app_user_branch_access`.

Admin (`ADMIN_MASTER` ou `ADMIN`) ve todas as filiais. Os demais usuarios veem:

- solicitacoes da filial marcada no cadastro do usuario;
- solicitacoes criadas pelo proprio usuario no ADM;
- solicitacoes cujo solicitante Fluig corresponde ao `fluig_username` do perfil.
