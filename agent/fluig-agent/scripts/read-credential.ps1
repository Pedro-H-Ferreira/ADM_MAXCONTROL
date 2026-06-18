param(
  [string]$ConfigDir = "$env:APPDATA\ADM MaxControl\fluig-agent"
)

$ErrorActionPreference = "Stop"
$CredentialFile = Join-Path $ConfigDir "fluig-credential.json"

if (-not (Test-Path -LiteralPath $CredentialFile)) {
  throw "Credencial Fluig nao encontrada em $CredentialFile"
}

$Payload = Get-Content -LiteralPath $CredentialFile -Raw | ConvertFrom-Json
$SecurePassword = ConvertTo-SecureString -String $Payload.passwordDpapi
$Credential = New-Object System.Management.Automation.PSCredential($Payload.username, $SecurePassword)

[ordered]@{
  username = $Credential.UserName
  password = $Credential.GetNetworkCredential().Password
} | ConvertTo-Json -Compress
