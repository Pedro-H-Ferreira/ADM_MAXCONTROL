param(
  [string]$AdmApiUrl = "https://adm-maxcontrol.vercel.app",
  [string]$AgentToken,
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path,
  [int]$LocalPort = 4777,
  [string]$FluigBaseUrl,
  [string]$FluigUsername,
  [string]$FluigLoginPath = "/portal/p/1/pageworkflowview?processID=Atendimento%20Central%20de%20Lan%C3%A7amento%20-%20CONSINCO",
  [string]$FluigLancamentoPath = "/portal/p/1/pageworkflowview?processID=Atendimento%20Central%20de%20Lan%C3%A7amento%20-%20CONSINCO",
  [string]$FluigProcessUrl = "",
  [string]$TaskName = "ADM MaxControl Fluig Agent",
  [switch]$SkipDependencies
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $ProjectRoot.Trim().Trim('"').TrimEnd([char[]]@("\", "/"))
$ConfigDir = Join-Path $env:APPDATA "ADM MaxControl\fluig-agent"
$ConfigFile = Join-Path $ConfigDir "config.json"
$RunFile = Join-Path $ConfigDir "run-agent.cmd"
$LogDir = Join-Path $ConfigDir "logs"
$AgentLog = Join-Path $LogDir "agent.log"
$AgentScript = Join-Path $ProjectRoot "agent\fluig-agent\src\index.js"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-CommandPath([string]$CommandName) {
  $Command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $Command) {
    return $null
  }

  return $Command.Source
}

function Normalize-OriginUrl([string]$Value) {
  $Trimmed = $Value.Trim().TrimEnd("/")
  try {
    $Uri = [Uri]$Trimmed
    if (-not $Uri.Scheme -or -not $Uri.Authority) {
      throw "URL invalida"
    }

    return "$($Uri.Scheme)://$($Uri.Authority)"
  } catch {
    throw "URL base do Fluig invalida: $Value"
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

Write-Host "ADM MaxControl - Instalador do Agente Fluig" -ForegroundColor Green
Write-Host "Este instalador configura o agente somente para o usuario Windows atual."

if (-not (Test-Path -LiteralPath $AgentScript)) {
  throw "Nao encontrei o agente em $AgentScript. Execute este instalador dentro da pasta do projeto ADM_MAXCONTROL."
}

if (-not $AgentToken) {
  Write-Host ""
  Write-Host "No portal ADM, clique em 'Parear agente' e cole aqui o token gerado." -ForegroundColor Yellow
  $AgentToken = Read-Host "Token do agente"
}

if (-not $AgentToken.Trim()) {
  throw "Token do agente nao informado."
}

if (-not $FluigBaseUrl) {
  Write-Host ""
  Write-Host "Informe a URL base do Fluig, exemplo: https://suaempresa.fluig.cloudtotvs.com.br" -ForegroundColor Yellow
  $FluigBaseUrl = Read-Host "URL base do Fluig"
}

if (-not $FluigBaseUrl.Trim()) {
  throw "URL base do Fluig nao informada."
}

$FluigBaseUrl = Normalize-OriginUrl $FluigBaseUrl
if (-not $FluigProcessUrl.Trim()) {
  $FluigProcessUrl = "$FluigBaseUrl$FluigLancamentoPath"
}

$NodePath = Resolve-CommandPath "node.exe"
if (-not $NodePath) {
  throw "Node.js nao encontrado. Instale o Node.js 20 ou superior e execute o instalador novamente."
}

$NpmPath = Resolve-CommandPath "npm.cmd"
if (-not $NpmPath) {
  throw "npm nao encontrado. Instale o Node.js com npm e execute o instalador novamente."
}

$NodeMajor = (& $NodePath -p "Number(process.versions.node.split('.')[0])")
if ([int]$NodeMajor -lt 20) {
  throw "Node.js $(& $NodePath --version) encontrado. O agente requer Node.js 20 ou superior."
}

New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

$Config = [ordered]@{
  ADM_API_URL = $AdmApiUrl.TrimEnd("/")
  ADM_AGENT_TOKEN = $AgentToken.Trim()
  ADM_PROJECT_ROOT = $ProjectRoot
  LOCAL_AGENT_PORT = "$LocalPort"
  POLL_INTERVAL_MS = "3000"
  MACHINE_NAME = $env:COMPUTERNAME
  FLUIG_BASE_URL = $FluigBaseUrl.TrimEnd("/")
  FLUIG_LOGIN_PATH = $FluigLoginPath
  FLUIG_LANCAMENTO_PATH = $FluigLancamentoPath
  FLUIG_PROCESS_URL = $FluigProcessUrl
  FLUIG_TASK_USER_ID = "00130"
  HEADLESS = "true"
  SLOW_MO = "0"
  LOGIN_USER_SELECTOR = "#username"
  LOGIN_PASSWORD_SELECTOR = "#password"
  LOGIN_SUBMIT_SELECTOR = "#login-saml-button"
  POST_LOGIN_READY_SELECTOR = "#desktop"
  LANCAMENTO_FORM_READY_SELECTOR = "body"
  LANCAMENTO_SUBMIT_SELECTOR = "button[type=`"submit`"]"
}

Write-Step "Gravando configuracao local"
Write-Utf8NoBom -Path $ConfigFile -Content ($Config | ConvertTo-Json)

Write-Step "Salvando usuario e senha do Fluig com DPAPI do Windows"
if ($FluigUsername) {
  & (Join-Path $PSScriptRoot "save-credential.ps1") -ConfigDir $ConfigDir -Username $FluigUsername
} else {
  & (Join-Path $PSScriptRoot "save-credential.ps1") -ConfigDir $ConfigDir
}

if (-not $SkipDependencies) {
  Write-Step "Instalando dependencias do projeto"
  Push-Location $ProjectRoot
  try {
    & $NpmPath install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      throw "npm install falhou com codigo $LASTEXITCODE."
    }

    & $NpmPath exec playwright install chromium
    if ($LASTEXITCODE -ne 0) {
      throw "Instalacao do Chromium Playwright falhou com codigo $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Step "Pulando instalacao de dependencias"
}

$RunScript = @"
@echo off
cd /d "$ProjectRoot"
echo [%date% %time%] Iniciando ADM Fluig Agent >> "$AgentLog"
"$NodePath" "$AgentScript" >> "$AgentLog" 2>&1
set "AGENT_EXIT=%ERRORLEVEL%"
echo [%date% %time%] ADM Fluig Agent finalizado com codigo %AGENT_EXIT% >> "$AgentLog"
exit /b %AGENT_EXIT%
"@

$RunScript | Set-Content -LiteralPath $RunFile -Encoding ASCII

Write-Step "Criando tarefa agendada do Windows"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$ActionArgument = '/d /c "' + $RunFile + '"'
$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $ActionArgument
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null

Write-Step "Iniciando agente"
Start-ScheduledTask -TaskName $TaskName

$HealthUrl = "http://127.0.0.1:$LocalPort/health"
$Online = $false
for ($Attempt = 1; $Attempt -le 20; $Attempt += 1) {
  Start-Sleep -Seconds 1
  try {
    $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    if ($Health.success -eq $true) {
      $Online = $true
      break
    }
  } catch {
    $Online = $false
  }
}

Write-Host ""
if ($Online) {
  Write-Host "ADM Fluig Agent instalado e ONLINE." -ForegroundColor Green
} else {
  Write-Host "ADM Fluig Agent instalado, mas ainda nao respondeu no health local." -ForegroundColor Yellow
  Write-Host "Abra o arquivo de log para ver o erro: $AgentLog"
}

Write-Host "Health local: $HealthUrl"
Write-Host "Config local: $ConfigFile"
Write-Host "Log local: $AgentLog"
Write-Host "Tarefa agendada: $TaskName"
