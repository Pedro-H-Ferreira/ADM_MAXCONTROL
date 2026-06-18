param(
  [string]$TaskName = "ADM MaxControl Fluig Agent",
  [switch]$RemoveLocalConfig
)

$ErrorActionPreference = "Stop"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Tarefa agendada removida: $TaskName"
}

if ($RemoveLocalConfig) {
  $ConfigDir = Join-Path $env:APPDATA "ADM MaxControl\fluig-agent"
  if (Test-Path -LiteralPath $ConfigDir) {
    Remove-Item -LiteralPath $ConfigDir -Recurse -Force
    Write-Host "Config local removida: $ConfigDir"
  }
}
