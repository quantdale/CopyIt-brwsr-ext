$ErrorActionPreference = "Stop"
$extDist = "extension/dist/manifest.json"
if (-not (Test-Path $extDist)) { throw "Extension build missing at $extDist - run npm run build" }
$manifest = Get-Content $extDist | ConvertFrom-Json
if (-not $manifest.key) { throw "manifest missing key" }
$extId = (node scripts/get-extension-id.mjs $extDist).Trim()
Write-Host "Extension ID: $extId"
$hostExe = "native-host/target/release/copyit-native-host.exe"
if (-not (Test-Path $hostExe)) { throw "Host exe missing at $hostExe" }
$installDir = Join-Path $env:LOCALAPPDATA "CopyIt Browser Extension/native-host"
$hostManifest = Join-Path $installDir "com.quantdale.copyit.json"
if (-not (Test-Path $hostManifest)) { throw "Host manifest missing at $hostManifest" }
$hm = Get-Content $hostManifest | ConvertFrom-Json
if ($hm.allowed_origins -notcontains "chrome-extension://$extId/") { throw "allowed_origins mismatch: $($hm.allowed_origins)" }
foreach ($browser in @("Google/Chrome", "Microsoft/Edge")) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.quantdale.copyit"
  if (Test-Path $key) {
    $val = (Get-ItemProperty -Path $key -Name "(default)")."(default)"
    if ($val -ne $hostManifest) { Write-Warning "$browser registry points to $val, expected $hostManifest" } else { Write-Host "$browser registry OK" }
  } else { Write-Host "$browser not registered (ok if not installed)" }
}
& $hostExe --self-test
if ($LASTEXITCODE -ne 0) { throw "host --self-test failed" }
Write-Host "Verify succeeded."
