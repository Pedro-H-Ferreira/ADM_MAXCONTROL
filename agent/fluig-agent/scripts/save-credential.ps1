param(
  [string]$ConfigDir = "$env:APPDATA\ADM MaxControl\fluig-agent",
  [string]$Username
)

$ErrorActionPreference = "Stop"

if (-not $Username) {
  $Username = Read-Host "Usuario Fluig"
}

$Password = Read-Host "Senha Fluig" -AsSecureString
$CredentialFile = Join-Path $ConfigDir "fluig-credential.json"

New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

$EncryptedPassword = ConvertFrom-SecureString -SecureString $Password
$Payload = [ordered]@{
  username = $Username
  passwordDpapi = $EncryptedPassword
  savedAt = (Get-Date).ToUniversalTime().ToString("o")
}

$Payload | ConvertTo-Json | Set-Content -LiteralPath $CredentialFile -Encoding UTF8
Write-Host "Credencial Fluig salva para o usuario Windows atual em $CredentialFile"
