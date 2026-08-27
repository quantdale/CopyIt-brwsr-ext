param([switch]$OpenExtensions)
$ErrorActionPreference = "Stop"
$hostPath = "native-host/target/release/copyit-native-host.exe"
if (-not (Test-Path $hostPath)) {
  Write-Host "Building release host..."
  cargo build --release --manifest-path native-host/Cargo.toml
  if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
}
npm ci | Out-Null
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
npm run build | Out-Null
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
$extId = (node scripts/get-extension-id.mjs extension/dist/manifest.json).Trim()
if ($LASTEXITCODE -ne 0) { throw "extension ID derivation failed" }
if (-not $extId) { throw "Could not derive extension ID" }
Write-Host "Extension ID: $extId"
$installDir = Join-Path $env:LOCALAPPDATA "CopyIt Browser Extension/native-host"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$installedExe = Join-Path $installDir "copyit-native-host.exe"
Copy-Item $hostPath $installedExe -Force
# Generate the native-host manifest directly into the install dir with the
# absolute path of the *installed* binary (never a stale intermediate file).
$hostManifest = Join-Path $installDir "com.quantdale.copyit.json"
node scripts/generate-host-manifest.mjs extension/dist/manifest.json $installedExe $hostManifest | Out-Null
if (($LASTEXITCODE -ne 0) -or (-not (Test-Path $hostManifest))) { throw "host manifest generation failed" }
# Register for Chrome and Edge (HKCU, no admin)
foreach ($browser in @("Google/Chrome", "Microsoft/Edge")) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.quantdale.copyit"
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name "(default)" -Value $hostManifest
  Write-Host "Registered $browser"
}
& (Join-Path $installDir "copyit-native-host.exe") --self-test
if ($LASTEXITCODE -ne 0) { throw "host --self-test failed" }
Write-Host "Install complete. Load unpacked extension from: $(Resolve-Path extension/dist)"
Write-Host "Chrome: chrome://extensions -> Developer mode -> Load unpacked"
Write-Host "Edge: edge://extensions -> Developer mode -> Load unpacked"
if ($OpenExtensions) { Start-Process "chrome://extensions"; Start-Process "edge://extensions" }
