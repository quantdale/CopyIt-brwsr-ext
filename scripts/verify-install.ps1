param(
  [ValidateSet("Chrome","Edge","Both")]
  [string]$Browser = "Both"
)
$ErrorActionPreference = "Stop"

Write-Host "=== CopyIt verify-install (strict) ===" -ForegroundColor Cyan
Write-Host "Browser mode: $Browser"

$extDist = "extension/dist/manifest.json"
if (-not (Test-Path $extDist)) { throw "Extension build missing at $extDist - run npm run build" }
$manifest = Get-Content $extDist -Raw | ConvertFrom-Json
if (-not $manifest.key) { throw "manifest missing key at $extDist (deterministic extension ID requires committed public key)" }
try { $null = [Convert]::FromBase64String($manifest.key) } catch { throw "manifest key is not valid base64" }
$extId = (node scripts/get-extension-id.mjs $extDist).Trim()
if (-not $extId -or $extId.Length -ne 32) { throw "derived extension ID invalid: '$extId'" }
if ($extId -ne "mmiopnfmhmmlmhcdjklelfcdahmgchfc") {
  Write-Warning "Derived extension ID $extId differs from committed deterministic ID mmiopnfmhmmlmhcdjklelfcdahmgchfc (manifest key drift?)"
  throw "extension ID mismatch: expected mmiopnfmhmmlmhcdjklelfcdahmgchfc, got $extId"
}
Write-Host "Extension ID: $extId (deterministic)"

$hostExe = "native-host/target/release/copyit-native-host.exe"
if (-not (Test-Path $hostExe)) { throw "Host exe missing at $hostExe - run cargo build --release --manifest-path native-host/Cargo.toml" }
Write-Host "Host exe present: $hostExe"

$installDir = Join-Path $env:LOCALAPPDATA "CopyIt Browser Extension/native-host"
$hostManifest = Join-Path $installDir "com.quantdale.copyit.json"
if (-not (Test-Path $hostManifest)) { throw "Host manifest missing at $hostManifest - run scripts/install.ps1" }
Write-Host "Host manifest present: $hostManifest"

try { $hm = Get-Content $hostManifest -Raw | ConvertFrom-Json } catch { throw "host manifest JSON invalid at $hostManifest : $_" }

if ($hm.name -ne "com.quantdale.copyit") { throw "host manifest name mismatch: expected 'com.quantdale.copyit', got '$($hm.name)'" }
if ($hm.type -ne "stdio") { throw "host manifest type mismatch: expected 'stdio', got '$($hm.type)'" }
if (-not $hm.path) { throw "host manifest missing 'path' field" }
if (-not [System.IO.Path]::IsPathRooted($hm.path)) { throw "host manifest path must be absolute, got '$($hm.path)'" }
if (-not (Test-Path $hm.path)) { throw "host manifest path target does not exist: $($hm.path)" }
$expectedOrigins = @("chrome-extension://$extId/")
if (-not $hm.allowed_origins) { throw "host manifest missing allowed_origins" }
if ($hm.allowed_origins.Count -ne 1) { throw "host manifest must have exactly one allowed_origin, got $($hm.allowed_origins.Count): $($hm.allowed_origins -join ', ')" }
if ($hm.allowed_origins[0] -ne $expectedOrigins[0]) { throw "allowed_origins mismatch: expected '$($expectedOrigins[0])', got '$($hm.allowed_origins[0])'" }
$requiredBrowsers = @()
switch ($Browser) {
  "Chrome" { $requiredBrowsers = @("Google/Chrome") }
  "Edge"   { $requiredBrowsers = @("Microsoft/Edge") }
  "Both"   { $requiredBrowsers = @("Google/Chrome", "Microsoft/Edge") }
}

$missing = @()
foreach ($browserKey in $requiredBrowsers) {
  $key = "HKCU:\Software\$browserKey\NativeMessagingHosts\com.quantdale.copyit"
  if (-not (Test-Path $key)) {
    $missing += $browserKey
    Write-Error "$browserKey registry missing at $key (expected to point to $hostManifest)"
    continue
  }
  $val = (Get-ItemProperty -Path $key -Name "(default)")."(default)"
  if ($val -ne $hostManifest) {
    throw "$browserKey registry points to '$val', expected '$hostManifest'"
  }
  Write-Host "$browserKey registry OK -> $val" -ForegroundColor Green
}
if ($missing.Count -gt 0) {
  throw "Missing required browser registrations: $($missing -join ', ') (Browser mode: $Browser). Install with scripts/install.ps1 or specify -Browser to limit verification."
}
# Also warn if unexpected extra registrations? For Both mode we already checked both, strict. For single browser mode, we don't fail on other missing.
# But we should ensure no extra origins in manifest already checked.

# Self-test
Write-Host "Running host --self-test..."
& $hm.path --self-test
if ($LASTEXITCODE -ne 0) { throw "host --self-test failed (exit $LASTEXITCODE) for $($hm.path)" }
Write-Host "Host self-test PASS" -ForegroundColor Green

# Also run the checked-out release exe self-test for parity
& $hostExe --self-test
if ($LASTEXITCODE -ne 0) { throw "host --self-test failed for built exe $hostExe" }

Write-Host "Verify succeeded (strict, Browser=$Browser)." -ForegroundColor Green
