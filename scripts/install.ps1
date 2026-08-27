param([switch]$OpenExtensions)
$ErrorActionPreference = "Stop"
$hostPath = "native-host/target/release/copyit-native-host.exe"
if (-not (Test-Path $hostPath)) {
  Write-Host "Building release host..."
  cargo build --release --manifest-path native-host/Cargo.toml
  if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
}
npm ci | Out-Null
npm run build | Out-Null
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
$extId = (node scripts/get-extension-id.mjs extension/dist/manifest.json).Trim()
if (-not $extId) { throw "Could not derive extension ID" }
Write-Host "Extension ID: $extId"
$installDir = Join-Path $env:LOCALAPPDATA "CopyIt Browser Extension/native-host"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item $hostPath (Join-Path $installDir "copyit-native-host.exe") -Force
node scripts/generate-host-manifest.mjs | Out-Null
$manifestSrc = "scripts/host-manifest.json"
if (-not (Test-Path $manifestSrc)) { throw "host manifest not generated" }
Copy-Item $manifestSrc (Join-Path $installDir "com.quantdale.copyit.json") -Force
# Register for Chrome and Edge (HKCU, no admin)
foreach ($browser in @("Google/Chrome", "Microsoft/Edge")) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.quantdale.copyit"
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name "(default)" -Value (Join-Path $installDir "com.quantdale.copyit.json")
  Write-Host "Registered $browser"
}
& (Join-Path $installDir "copyit-native-host.exe") --self-test
if ($LASTEXITCODE -ne 0) { throw "host --self-test failed" }
Write-Host "Install complete. Load unpacked extension from: $(Resolve-Path extension/dist)"
Write-Host "Chrome: chrome://extensions -> Developer mode -> Load unpacked"
Write-Host "Edge: edge://extensions -> Developer mode -> Load unpacked"
if ($OpenExtensions) { Start-Process "chrome://extensions"; Start-Process "edge://extensions" }
