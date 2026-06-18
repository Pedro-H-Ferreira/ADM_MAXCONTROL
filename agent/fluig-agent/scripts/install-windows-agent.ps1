param(
  [string]$AdmApiUrl = "https://adm-maxcontrol.vercel.app",
  [Parameter(Mandatory = $true)]
  [string]$AgentToken,
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path,
  [int]$LocalPort = 4777,
  [string]$FluigBaseUrl,
  [string]$FluigLoginPath = "/portal/p/1/pageworkflowview?processID=Atendimento%20Central%20de%20Lan%C3%A7amento%20-%20CONSINCO",
  [string]$FluigLancamentoPath = "/portal/p/1/pageworkflowview?processID=Atendimento%20Central%20de%20Lan%C3%A7amento%20-%20CONSINCO",
  [string]$FluigProcessUrl = "",
  [string]$TaskName = "ADM MaxControl Fluig Agent"
)

$ErrorActionPreference = "Stop"
$ConfigDir = Join-Path $env:APPDATA "ADM MaxControl\fluig-agent"
$ConfigFile = Join-Path $ConfigDir "config.json"
$AgentScript = Join-Path $ProjectRoot "agent\fluig-agent\src\index.js"

if (-not $FluigBaseUrl) {
  $FluigBaseUrl = Read-Host "FLUIG_BASE_URL"
}

New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

$Config = [ordered]@{
  ADM_API_URL = $AdmApiUrl.TrimEnd("/")
  ADM_AGENT_TOKEN = $AgentToken
  ADM_PROJECT_ROOT = $ProjectRoot
  LOCAL_AGENT_PORT = "$LocalPort"
  POLL_INTERVAL_MS = "3000"
  MACHINE_NAME = $env:COMPUTERNAME
  FLUIG_BASE_URL = $FluigBaseUrl
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

$Config | ConvertTo-Json | Set-Content -LiteralPath $ConfigFile -Encoding UTF8

& (Join-Path $PSScriptRoot "save-credential.ps1") -ConfigDir $ConfigDir

Push-Location $ProjectRoot
try {
  npm install
  npx playwright install chromium
} finally {
  Pop-Location
}

$Action = New-ScheduledTaskAction -Execute "node.exe" -Argument "`"$AgentScript`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel LeastPrivilege
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "ADM Fluig Agent instalado e iniciado."
Write-Host "Health local: http://127.0.0.1:$LocalPort/health"
