param(
  [string]$TaskName = "ADM MaxControl Fluig Agent",
  [int]$LocalPort = 4777,
  [string]$ConfigDir = "$env:APPDATA\ADM MaxControl\fluig-agent"
)

$ErrorActionPreference = "Continue"

$ConfigFile = Join-Path $ConfigDir "config.json"
$CredentialFile = Join-Path $ConfigDir "fluig-credential.json"
$AgentLog = Join-Path $ConfigDir "logs\agent.log"
$HealthUrl = "http://127.0.0.1:$LocalPort/health"

Write-Host "ADM MaxControl - Diagnostico do Agente Fluig" -ForegroundColor Green
Write-Host ""

Write-Host "Arquivos locais"
Write-Host "- Config: $ConfigFile"
Write-Host "- Credencial: $CredentialFile"
Write-Host "- Log: $AgentLog"
Write-Host ""

Write-Host "Status dos arquivos"
Write-Host "- Config existe: $(Test-Path -LiteralPath $ConfigFile)"
Write-Host "- Credencial existe: $(Test-Path -LiteralPath $CredentialFile)"
Write-Host "- Log existe: $(Test-Path -LiteralPath $AgentLog)"
Write-Host ""

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
  Write-Host "Tarefa agendada"
  Write-Host "- Nome: $TaskName"
  Write-Host "- Estado: $($Task.State)"
  $TaskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($TaskInfo) {
    Write-Host "- Ultima execucao: $($TaskInfo.LastRunTime)"
    Write-Host "- Ultimo resultado: $($TaskInfo.LastTaskResult)"
    Write-Host "- Proxima execucao: $($TaskInfo.NextRunTime)"
  }
} else {
  Write-Host "Tarefa agendada nao encontrada: $TaskName" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Health local"
try {
  $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
  $Health | ConvertTo-Json -Depth 8
} catch {
  Write-Host "Nao respondeu em $HealthUrl" -ForegroundColor Yellow
  Write-Host $_.Exception.Message
}

Write-Host ""
if (Test-Path -LiteralPath $AgentLog) {
  Write-Host "Ultimas linhas do log"
  Get-Content -LiteralPath $AgentLog -Tail 80
} else {
  Write-Host "Log ainda nao foi criado."
}
