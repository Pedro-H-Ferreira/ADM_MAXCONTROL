param(
  [string]$TaskName = "ADM MaxControl Fluig Agent",
  [switch]$RemoveLocalConfig
)

$ErrorActionPreference = "Stop"
$ConfigDir = Join-Path $env:APPDATA "ADM MaxControl\fluig-agent"
$ConfigFile = Join-Path $ConfigDir "config.json"
$AgentScript = $null

if (Test-Path -LiteralPath $ConfigFile) {
  $Config = Get-Content -Raw -LiteralPath $ConfigFile | ConvertFrom-Json
  if ($Config.ADM_PROJECT_ROOT) {
    $AgentScript = Join-Path ([string]$Config.ADM_PROJECT_ROOT) "agent\fluig-agent\src\index.js"
  }
}

function Stop-AgentProcesses([string]$AgentScriptPath) {
  if (-not $AgentScriptPath) {
    return
  }

  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$AgentScriptPath*" } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Tarefa agendada removida: $TaskName"
}
Stop-AgentProcesses -AgentScriptPath $AgentScript

if ($RemoveLocalConfig) {
  if (Test-Path -LiteralPath $ConfigDir) {
    Remove-Item -LiteralPath $ConfigDir -Recurse -Force
    Write-Host "Config local removida: $ConfigDir"
  }
}
