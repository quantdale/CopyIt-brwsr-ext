param([switch]$OpenExtensions)
$ErrorActionPreference = "Stop"
cargo build --release --manifest-path native-host/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
npm ci | Out-Null
npm run build | Out-Null
$extId = (node scripts/get-extension-id.mjs extension/dist/manifest.json).Trim()
$targetExe = Resolve-Path "native-host/target/release/copyit-native-host.exe"
# Write host manifest pointing at target binary
$manifestPath = "scripts/host-manifest.json"
$manifest = Get-Content $manifestPath | ConvertFrom-Json
$manifest.path = $targetExe.Path
$manifest.allowed_origins = @("chrome-extension://$extId/")
$manifest | ConvertTo-Json -Depth 4 | Set-Content $manifestPath -Encoding utf8
foreach ($browser in @("Google/Chrome", "Microsoft/Edge")) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.quantdale.copyit"
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name "(default)" -Value (Resolve-Path $manifestPath).Path
}
Write-Host "Dev install: host manifest points at $targetExe (rebuild will require re-registration if path changes). ID $extId"
