param(
  [string]$ProjectId = "4660020320183620207",
  [string]$OutputRoot = "",
  [string]$CodexConfigPath = "$env:USERPROFILE\.codex\config.toml"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path (Get-Location) "stitch-export\$ProjectId"
}

$McpUrl = "https://stitch.googleapis.com/mcp"
$Script:NextJsonRpcId = 1
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
  )

  $parent = Split-Path -Parent $Path
  if (-not [string]::IsNullOrWhiteSpace($parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

function ConvertTo-JsonFile {
  param(
    [Parameter(Mandatory = $true)]$Value,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $json = $Value | ConvertTo-Json -Depth 100
  Write-Utf8File -Path $Path -Content $json
}

function Get-ApiKey {
  if (-not [string]::IsNullOrWhiteSpace($env:STITCH_API_KEY)) {
    return $env:STITCH_API_KEY
  }

  if (-not (Test-Path -LiteralPath $CodexConfigPath)) {
    throw "Stitch API key not found. Set STITCH_API_KEY or provide a Codex config path."
  }

  $config = Get-Content -Raw -LiteralPath $CodexConfigPath
  $match = [regex]::Match($config, '"X-Goog-Api-Key"\s*=\s*"([^"]+)"')
  if (-not $match.Success) {
    throw "Stitch API key not found in Codex config."
  }

  return $match.Groups[1].Value
}

function Invoke-McpTool {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)]$Arguments
  )

  $body = @{
    jsonrpc = "2.0"
    id = $Script:NextJsonRpcId
    method = "tools/call"
    params = @{
      name = $Name
      arguments = $Arguments
    }
  } | ConvertTo-Json -Depth 100 -Compress

  $Script:NextJsonRpcId += 1

  $lastError = $null
  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    try {
      $response = Invoke-WebRequest `
        -UseBasicParsing `
        -Uri $McpUrl `
        -Method Post `
        -Headers @{
          "X-Goog-Api-Key" = $Script:ApiKey
          "Accept" = "application/json, text/event-stream"
        } `
        -ContentType "application/json" `
        -Body $body

      $json = $response.Content | ConvertFrom-Json
      if ($null -ne $json.error) {
        throw "MCP tool '$Name' failed: $($json.error | ConvertTo-Json -Compress)"
      }

      $textContent = @($json.result.content) | Where-Object { $_.type -eq "text" } | Select-Object -First 1
      if ($null -eq $textContent) {
        return $json.result
      }

      return ($textContent.text | ConvertFrom-Json)
    } catch {
      $lastError = $_
      if ($attempt -lt 3) {
        Start-Sleep -Seconds ([Math]::Min(5, $attempt * 2))
      }
    }
  }

  throw $lastError
}

function Get-ObjectProperty {
  param($Object, [string]$Name)

  if ($null -eq $Object) {
    return $null
  }

  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop) {
    return $null
  }

  return $prop.Value
}

function Get-ScreenIdFromName {
  param([string]$Name)

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return $null
  }

  if ($Name -match "/screens/([^/]+)$") {
    return $Matches[1]
  }

  return ($Name -split "/")[-1]
}

function New-Slug {
  param([string]$Text, [string]$Fallback)

  if ([string]::IsNullOrWhiteSpace($Text)) {
    $Text = $Fallback
  }

  $normalized = $Text.Normalize([System.Text.NormalizationForm]::FormD)
  $builder = New-Object System.Text.StringBuilder

  foreach ($char in $normalized.ToCharArray()) {
    $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($char)
    if ($category -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$builder.Append($char)
    }
  }

  $slug = $builder.ToString().Normalize([System.Text.NormalizationForm]::FormC).ToLowerInvariant()
  $slug = [regex]::Replace($slug, "[^a-z0-9]+", "-").Trim("-")
  if ([string]::IsNullOrWhiteSpace($slug)) {
    $slug = $Fallback
  }

  if ($slug.Length -gt 80) {
    $slug = $slug.Substring(0, 80).Trim("-")
  }

  return $slug
}

function Get-ExtensionForMime {
  param([string]$MimeType)

  switch -Regex ($MimeType) {
    "^text/html" { return ".html" }
    "^text/markdown" { return ".md" }
    default { return ".txt" }
  }
}

function Download-Url {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null

  $metaPrefix = "CURL_META:"
  $curlArgs = @(
    "-L",
    "--fail",
    "--retry", "3",
    "--retry-delay", "1",
    "--silent",
    "--show-error",
    "-w", "`n$metaPrefix%{http_code}|%{content_type}|%{size_download}",
    "-o", $Destination,
    $Url
  )

  $output = & curl.exe @curlArgs 2>&1
  $exitCode = $LASTEXITCODE
  $outputLines = @($output)
  $metaLine = $outputLines | Where-Object { $_ -like "$metaPrefix*" } | Select-Object -Last 1
  $stderr = ($outputLines | Where-Object { $_ -notlike "$metaPrefix*" }) -join "`n"

  $result = [ordered]@{
    ok = $false
    path = $Destination
    bytes = 0
    httpStatus = $null
    contentType = $null
    error = $null
  }

  if ($null -ne $metaLine) {
    $parts = $metaLine.Substring($metaPrefix.Length).Split("|", 3)
    if ($parts.Count -ge 1) { $result.httpStatus = $parts[0] }
    if ($parts.Count -ge 2) { $result.contentType = $parts[1] }
    if ($parts.Count -ge 3) {
      $downloadBytes = 0.0
      if ([double]::TryParse($parts[2], [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$downloadBytes)) {
        $result.bytes = [int64]$downloadBytes
      }
    }
  }

  if ($exitCode -ne 0) {
    $result.error = "curl exit code $exitCode. $stderr".Trim()
    return [pscustomobject]$result
  }

  if (-not (Test-Path -LiteralPath $Destination)) {
    $result.error = "File was not created."
    return [pscustomobject]$result
  }

  $file = Get-Item -LiteralPath $Destination
  $result.bytes = $file.Length
  if ($file.Length -le 0) {
    $result.error = "File is empty."
    return [pscustomobject]$result
  }

  $result.ok = $true
  return [pscustomobject]$result
}

function Test-PngSignature {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    if ($stream.Length -lt 8) {
      return $false
    }

    $bytes = New-Object byte[] 8
    [void]$stream.Read($bytes, 0, 8)
    $expected = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    for ($i = 0; $i -lt 8; $i += 1) {
      if ($bytes[$i] -ne $expected[$i]) {
        return $false
      }
    }

    return $true
  } finally {
    $stream.Dispose()
  }
}

function Test-JpegSignature {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    if ($stream.Length -lt 2) {
      return $false
    }

    $bytes = New-Object byte[] 2
    [void]$stream.Read($bytes, 0, 2)
    return ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8)
  } finally {
    $stream.Dispose()
  }
}

function Get-ImageExtensionForContentType {
  param([string]$ContentType)

  switch -Regex ($ContentType) {
    "^image/png" { return ".png" }
    "^image/jpeg" { return ".jpg" }
    "^image/webp" { return ".webp" }
    default { return ".bin" }
  }
}

function Add-ScreenRecord {
  param(
    [hashtable]$Records,
    [string]$ScreenId,
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($ScreenId)) {
    return
  }

  if (-not $Records.ContainsKey($ScreenId)) {
    $Records[$ScreenId] = [ordered]@{
      screenId = $ScreenId
      name = $(if ([string]::IsNullOrWhiteSpace($Name)) { "projects/$ProjectId/screens/$ScreenId" } else { $Name })
      title = $null
      listedByListScreens = $false
      instances = @()
      fetched = $false
      fetchError = $null
      screenFolder = $null
      html = $null
      screenshot = $null
      missing = @()
      validation = @()
      source = $null
    }
  }
}

$Script:ApiKey = Get-ApiKey

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutputRoot "raw\screens") | Out-Null

Write-Host "Fetching Stitch project $ProjectId..."
$project = Invoke-McpTool -Name "get_project" -Arguments @{ name = "projects/$ProjectId" }
$listScreensResult = Invoke-McpTool -Name "list_screens" -Arguments @{ projectId = $ProjectId }

ConvertTo-JsonFile -Value $project -Path (Join-Path $OutputRoot "raw\project.json")
ConvertTo-JsonFile -Value $listScreensResult -Path (Join-Path $OutputRoot "raw\list-screens.json")

$designMd = Get-ObjectProperty -Object (Get-ObjectProperty -Object $project -Name "designTheme") -Name "designMd"
if ($null -eq $designMd) {
  $designMd = ""
}
Write-Utf8File -Path (Join-Path $OutputRoot "design-system.md") -Content $designMd

$recordsById = @{}
$listedScreens = @($listScreensResult.screens)

foreach ($screen in $listedScreens) {
  $screenId = Get-ScreenIdFromName -Name $screen.name
  Add-ScreenRecord -Records $recordsById -ScreenId $screenId -Name $screen.name
  $record = $recordsById[$screenId]
  $record.listedByListScreens = $true
  $record.title = $screen.title
  $record.source = $screen
}

$screenInstances = @($project.screenInstances)
$nonScreenInstances = @()
foreach ($instance in $screenInstances) {
  $sourceScreen = Get-ObjectProperty -Object $instance -Name "sourceScreen"
  if ([string]::IsNullOrWhiteSpace($sourceScreen)) {
    $nonScreenInstances += $instance
    continue
  }

  $screenId = Get-ScreenIdFromName -Name $sourceScreen
  Add-ScreenRecord -Records $recordsById -ScreenId $screenId -Name $sourceScreen
  $record = $recordsById[$screenId]
  $currentInstances = @($record.instances)
  $record.instances = @($currentInstances + $instance)
}

$screenIds = @($recordsById.Keys | Sort-Object)
Write-Host "Discovered $($screenIds.Count) unique screen IDs from list_screens and screenInstances."

$index = 0
foreach ($screenId in $screenIds) {
  $index += 1
  $record = $recordsById[$screenId]
  Write-Host ("[{0}/{1}] Fetching screen {2}" -f $index, $screenIds.Count, $screenId)

  try {
    $screen = Invoke-McpTool -Name "get_screen" -Arguments @{
      projectId = $ProjectId
      screenId = $screenId
      name = "projects/$ProjectId/screens/$screenId"
    }

    $record.fetched = $true
    $record.source = $screen
    if (-not [string]::IsNullOrWhiteSpace($screen.title)) {
      $record.title = $screen.title
    }

    ConvertTo-JsonFile -Value $screen -Path (Join-Path $OutputRoot "raw\screens\$screenId.json")
  } catch {
    $record.fetchError = $_.Exception.Message
  }
}

$downloadedHtml = 0
$downloadedScreenshots = 0
$failedDownloads = 0
$missingHtml = 0
$missingScreenshots = 0
$validationWarnings = 0
$screenSummaries = @()

foreach ($screenId in $screenIds) {
  $record = $recordsById[$screenId]
  $source = $record.source
  $title = $record.title
  $slug = New-Slug -Text $title -Fallback $screenId
  $screenFolderName = "$slug-$screenId"
  $screenFolder = Join-Path (Join-Path $OutputRoot "screens") $screenFolderName
  New-Item -ItemType Directory -Force -Path $screenFolder | Out-Null
  $record.screenFolder = $screenFolder

  $htmlCode = Get-ObjectProperty -Object $source -Name "htmlCode"
  $htmlUrl = Get-ObjectProperty -Object $htmlCode -Name "downloadUrl"
  $htmlMime = Get-ObjectProperty -Object $htmlCode -Name "mimeType"
  if (-not [string]::IsNullOrWhiteSpace($htmlUrl)) {
    $ext = Get-ExtensionForMime -MimeType $htmlMime
    $htmlPath = Join-Path $screenFolder "screen$ext"
    $download = Download-Url -Url $htmlUrl -Destination $htmlPath
    $htmlValidation = @()

    if ($download.ok) {
      $downloadedHtml += 1
      if (-not [string]::IsNullOrWhiteSpace($htmlMime) -and $download.contentType -notlike "$htmlMime*") {
        $htmlValidation += "Expected content type '$htmlMime', downloaded '$($download.contentType)'."
      }
      if (($ext -eq ".html") -and ($download.contentType -notlike "text/html*")) {
        $htmlValidation += "HTML file content type validation failed."
      }
      if (($ext -eq ".md") -and ($download.contentType -notlike "text/markdown*" -and $download.contentType -notlike "text/plain*")) {
        $htmlValidation += "Markdown file content type validation failed."
      }
    } else {
      $failedDownloads += 1
    }

    if ($htmlValidation.Count -gt 0) {
      $validationWarnings += $htmlValidation.Count
      $record.validation = @($record.validation + $htmlValidation)
    }

    $record.html = [ordered]@{
      sourceName = Get-ObjectProperty -Object $htmlCode -Name "name"
      mimeType = $htmlMime
      downloadUrl = $htmlUrl
      localPath = $htmlPath
      download = $download
    }
  } else {
    $missingHtml += 1
    $record.missing = @($record.missing + "htmlCode")
  }

  $screenshot = Get-ObjectProperty -Object $source -Name "screenshot"
  $screenshotUrl = Get-ObjectProperty -Object $screenshot -Name "downloadUrl"
  if (-not [string]::IsNullOrWhiteSpace($screenshotUrl)) {
    $temporaryScreenshotPath = Join-Path $screenFolder "screenshot.download"
    $download = Download-Url -Url $screenshotUrl -Destination $temporaryScreenshotPath
    $screenshotValidation = @()
    $screenshotPath = $temporaryScreenshotPath

    if ($download.ok) {
      $downloadedScreenshots += 1
      $imageExtension = Get-ImageExtensionForContentType -ContentType $download.contentType
      $screenshotPath = Join-Path $screenFolder "screenshot$imageExtension"
      Move-Item -Force -LiteralPath $temporaryScreenshotPath -Destination $screenshotPath
      $download.path = $screenshotPath

      if ($download.contentType -like "image/png*") {
        if (-not (Test-PngSignature -Path $screenshotPath)) {
          $screenshotValidation += "PNG signature validation failed."
        }
      } elseif ($download.contentType -like "image/jpeg*") {
        if (-not (Test-JpegSignature -Path $screenshotPath)) {
          $screenshotValidation += "JPEG signature validation failed."
        }
      } elseif ($download.contentType -like "image/webp*") {
        if ((Get-Item -LiteralPath $screenshotPath).Length -le 0) {
          $screenshotValidation += "WEBP file is empty."
        }
      } else {
        $screenshotValidation += "Unexpected screenshot content type '$($download.contentType)'."
      }
    } else {
      $failedDownloads += 1
    }

    if ($screenshotValidation.Count -gt 0) {
      $validationWarnings += $screenshotValidation.Count
      $record.validation = @($record.validation + $screenshotValidation)
    }

    $record.screenshot = [ordered]@{
      sourceName = Get-ObjectProperty -Object $screenshot -Name "name"
      downloadUrl = $screenshotUrl
      localPath = $screenshotPath
      download = $download
    }
  } else {
    $missingScreenshots += 1
    $record.missing = @($record.missing + "screenshot")
  }

  ConvertTo-JsonFile -Value ([pscustomobject]$record) -Path (Join-Path $screenFolder "metadata.json")
  $screenSummaries += [pscustomobject]$record
}

$thumbnailResult = $null
$thumbnail = Get-ObjectProperty -Object $project -Name "thumbnailScreenshot"
$thumbnailUrl = Get-ObjectProperty -Object $thumbnail -Name "downloadUrl"
if (-not [string]::IsNullOrWhiteSpace($thumbnailUrl)) {
  $thumbnailPath = Join-Path $OutputRoot "thumbnail.png"
  $thumbnailDownload = Download-Url -Url $thumbnailUrl -Destination $thumbnailPath
  $thumbnailResult = [ordered]@{
    sourceName = Get-ObjectProperty -Object $thumbnail -Name "name"
    downloadUrl = $thumbnailUrl
    localPath = $thumbnailPath
    download = $thumbnailDownload
    validPngSignature = $(if ($thumbnailDownload.ok) { Test-PngSignature -Path $thumbnailPath } else { $false })
  }
}

$summary = [ordered]@{
  discoveredScreens = $screenIds.Count
  listedScreens = $listedScreens.Count
  screenInstances = $screenInstances.Count
  nonScreenInstances = $nonScreenInstances.Count
  fetchedScreens = @($screenSummaries | Where-Object { $_.fetched }).Count
  failedFetches = @($screenSummaries | Where-Object { -not $_.fetched }).Count
  downloadedHtml = $downloadedHtml
  missingHtml = $missingHtml
  downloadedScreenshots = $downloadedScreenshots
  missingScreenshots = $missingScreenshots
  failedDownloads = $failedDownloads
  validationWarnings = $validationWarnings
}

$manifest = [ordered]@{
  exportTime = (Get-Date).ToUniversalTime().ToString("o")
  projectId = $ProjectId
  project = [ordered]@{
    name = $project.name
    title = $project.title
    createTime = $project.createTime
    updateTime = $project.updateTime
    visibility = $project.visibility
    origin = $project.origin
    projectType = $project.projectType
    deviceType = $project.deviceType
    metadata = $project.metadata
  }
  designTheme = $project.designTheme
  thumbnailScreenshot = $thumbnailResult
  screenInstances = $screenInstances
  nonScreenInstances = $nonScreenInstances
  summary = $summary
  screens = $screenSummaries
}

ConvertTo-JsonFile -Value $manifest -Path (Join-Path $OutputRoot "manifest.json")

$reportLines = New-Object System.Collections.Generic.List[string]
$reportLines.Add("# Stitch export report")
$reportLines.Add("")
$reportLines.Add("- Project: $($project.title)")
$reportLines.Add("- Project ID: $ProjectId")
$reportLines.Add("- Export path: $OutputRoot")
$reportLines.Add("- Export time UTC: $($manifest.exportTime)")
$reportLines.Add("")
$reportLines.Add("## Summary")
$reportLines.Add("")
$reportLines.Add("- Discovered screens: $($summary.discoveredScreens)")
$reportLines.Add("- Screens from list_screens: $($summary.listedScreens)")
$reportLines.Add("- Project screen instances: $($summary.screenInstances)")
$reportLines.Add("- Non-screen instances: $($summary.nonScreenInstances)")
$reportLines.Add("- Fetched screen metadata: $($summary.fetchedScreens)")
$reportLines.Add("- Failed metadata fetches: $($summary.failedFetches)")
$reportLines.Add("- Downloaded HTML/Markdown files: $($summary.downloadedHtml)")
$reportLines.Add("- Screens without HTML/Markdown: $($summary.missingHtml)")
$reportLines.Add("- Downloaded screenshots: $($summary.downloadedScreenshots)")
$reportLines.Add("- Screens without screenshots: $($summary.missingScreenshots)")
$reportLines.Add("- Failed downloads: $($summary.failedDownloads)")
$reportLines.Add("- Validation warnings: $($summary.validationWarnings)")
$reportLines.Add("")
$reportLines.Add("## Files")
$reportLines.Add("")
$reportLines.Add("- Manifest: manifest.json")
$reportLines.Add("- Design system: design-system.md")
$reportLines.Add("- Raw project data: raw/project.json")
$reportLines.Add("- Raw listed screens: raw/list-screens.json")
$reportLines.Add("- Screen assets: screens/<slug>-<screenId>/")
$reportLines.Add("")
$reportLines.Add("## Missing or failed")
$reportLines.Add("")

$problemRows = @($screenSummaries | Where-Object {
  (-not $_.fetched) -or
  ($_.missing.Count -gt 0) -or
  ($_.validation.Count -gt 0) -or
  (($null -ne $_.html) -and (-not $_.html.download.ok)) -or
  (($null -ne $_.screenshot) -and (-not $_.screenshot.download.ok))
})

if ($problemRows.Count -eq 0) {
  $reportLines.Add("No missing assets, failed downloads, or validation warnings.")
} else {
  foreach ($row in $problemRows) {
    $titleForReport = if ([string]::IsNullOrWhiteSpace($row.title)) { $row.screenId } else { $row.title }
    $issues = New-Object System.Collections.Generic.List[string]
    if (-not $row.fetched) { $issues.Add("fetch failed: $($row.fetchError)") }
    foreach ($missing in @($row.missing)) { $issues.Add("missing $missing") }
    foreach ($warning in @($row.validation)) { $issues.Add($warning) }
    if (($null -ne $row.html) -and (-not $row.html.download.ok)) { $issues.Add("html download failed: $($row.html.download.error)") }
    if (($null -ne $row.screenshot) -and (-not $row.screenshot.download.ok)) { $issues.Add("screenshot download failed: $($row.screenshot.download.error)") }
    $reportLines.Add(("- {0} - {1} - {2}" -f $row.screenId, $titleForReport, ($issues -join "; ")))
  }
}

$reportLines.Add("")
$reportLines.Add("## Screens")
$reportLines.Add("")
foreach ($row in ($screenSummaries | Sort-Object title, screenId)) {
  $titleForReport = if ([string]::IsNullOrWhiteSpace($row.title)) { $row.screenId } else { $row.title }
  $relativeFolder = $row.screenFolder.Substring($OutputRoot.Length).TrimStart("\", "/")
  $assets = New-Object System.Collections.Generic.List[string]
  if (($null -ne $row.html) -and $row.html.download.ok) { $assets.Add("code") }
  if (($null -ne $row.screenshot) -and $row.screenshot.download.ok) { $assets.Add("screenshot") }
  if ($assets.Count -eq 0) { $assets.Add("metadata only") }
  $reportLines.Add(("- {0} - {1} - {2} - {3}" -f $row.screenId, $titleForReport, ($assets -join ", "), $relativeFolder))
}

Write-Utf8File -Path (Join-Path $OutputRoot "download-report.md") -Content ($reportLines -join "`n")

Write-Host ""
Write-Host "Export complete."
Write-Host "Path: $OutputRoot"
Write-Host "Discovered screens: $($summary.discoveredScreens)"
Write-Host "Downloaded HTML/Markdown: $($summary.downloadedHtml)"
Write-Host "Downloaded screenshots: $($summary.downloadedScreenshots)"
Write-Host "Failed downloads: $($summary.failedDownloads)"
Write-Host "Validation warnings: $($summary.validationWarnings)"
