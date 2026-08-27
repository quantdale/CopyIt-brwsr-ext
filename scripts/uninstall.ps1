$ErrorActionPreference = "Stop"
foreach ($browser in @("Google/Chrome", "Microsoft/Edge")) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.quantdale.copyit"
  if (Test-Path $key) { Remove-Item -Path $key -Force; Write-Host "Removed $browser registration" }
}
$installDir = Join-Path $env:LOCALAPPDATA "CopyIt Browser Extension/native-host"
if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir; Write-Host "Removed $installDir" }
Write-Host "Uninstall complete. User data at %APPDATA%\CopyIt\copyit.db was NOT deleted."
