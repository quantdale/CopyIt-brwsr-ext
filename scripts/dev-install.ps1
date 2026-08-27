param([switch]$OpenExtensions)
$ErrorActionPreference = "Stop"
cargo build --release --manifest-path native-host/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
npm ci | Out-Null
npm run build | Out-Null
$extId = (node scripts/get-extension-id.mjs extension/dist/manifest.json).Trim()
$targetExe = (Resolve-Path "native-host/target/release/copyit-native-host.exe").Path
# Write a dev host manifest pointing at the freshly built binary.
$manifestPath = Join-Path $PSScriptRoot "host-manifest.json"
node scripts/generate-host-manifest.mjs extension/dist/manifest.json $targetExe $manifestPath | Out-Null
if (($LASTEXITCODE -ne 0) -or (-not (Test-Path $manifestPath))) { throw "host manifest generation failed" }
$manifest = Get-Content $manifestPath | ConvertFrom-Json
if ($manifest.allowed_origins -notcontains "chrome-extension://$extId/") { throw "host manifest allowed_origins mismatch: $($manifest.allowed_origins)" }
foreach ($browser in @("Google/Chrome", "Microsoft/Edge")) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.quantdale.copyit"
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name "(default)" -Value $manifestPath
}
Write-Host "Dev install: host manifest at $manifestPath, exe $targetExe (rebuild will require re-registration if the path changes). ID $extId"
