param(
  [Parameter(Mandatory = $true)]
  [string]$SshHost,

  [Parameter(Mandatory = $true)]
  [string]$DestinationContainer,

  [string]$DumpImage = "supabase/postgres:17.6.1.084",

  [string]$RemoteDirectory = "/root/adm-maxcontrol-migration"
)

$ErrorActionPreference = "Stop"

function Export-SupabaseDump {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [string[]]$DumpArguments = @()
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $dryRun = & npx supabase db dump --linked --dry-run @DumpArguments 2>$null | Out-String
  $dumpExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference

  # Current CLI versions can return a non-zero exit code only because the
  # optional telemetry client timed out after the valid dry-run was emitted.
  if (-not $dryRun.Contains('PGPASSWORD=') -or -not $dryRun.Contains('pg_dump')) {
    throw "Nao foi possivel obter uma conexao temporaria para o dump $Name."
  }

  # The platform direct database endpoint is IPv6-only. The VPS host has IPv6,
  # while the regular Docker bridge does not, so the temporary dump container
  # uses the host network only for this read-only export.
  $remoteScript = $dryRun
  $containerPrefix = "docker run --rm --network host -i -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE $DumpImage"
  $remoteScript = [regex]::Replace($remoteScript, '(?m)^pg_dumpall(?=\s)', "$containerPrefix pg_dumpall", 1)
  $remoteScript = [regex]::Replace($remoteScript, '(?m)^pg_dump(?=\s)', "$containerPrefix pg_dump", 1)
  $remoteScript = $remoteScript.Replace("`r`n", "`n")

  $tempScript = Join-Path $env:TEMP "supabase-$Name-$([guid]::NewGuid().ToString('N')).sh"
  try {
    [System.IO.File]::WriteAllText($tempScript, $remoteScript, [System.Text.UTF8Encoding]::new($false))
    Get-Content -LiteralPath $tempScript -Raw |
      ssh -o BatchMode=yes $SshHost "umask 077; bash -s > '$RemoteDirectory/$Name.sql'"

    if ($LASTEXITCODE -ne 0) {
      throw "Falha ao gerar $Name.sql na VPS."
    }
  }
  finally {
    Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
  }
}

ssh -o BatchMode=yes $SshHost "install -d -m 700 '$RemoteDirectory'"
if ($LASTEXITCODE -ne 0) {
  throw "Nao foi possivel preparar o diretorio privado de migracao na VPS."
}

# The source project has no custom roles. Managed Supabase blocks reading
# pg_authid from temporary CLI roles, so the roles phase is intentionally a
# no-op instead of exporting platform-managed roles into self-hosted Postgres.
ssh -o BatchMode=yes $SshHost "printf 'RESET ALL;\n' > '$RemoteDirectory/roles.sql'"
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao preparar roles.sql na VPS."
}

Export-SupabaseDump -Name "schema"
Export-SupabaseDump -Name "data" -DumpArguments @("--data-only", "--use-copy")

ssh -o BatchMode=yes $SshHost "test -s '$RemoteDirectory/roles.sql' -a -s '$RemoteDirectory/schema.sql' -a -s '$RemoteDirectory/data.sql' && stat -c '%n|%s' '$RemoteDirectory'/*.sql"
if ($LASTEXITCODE -ne 0) {
  throw "Um ou mais arquivos de dump ficaram vazios."
}
