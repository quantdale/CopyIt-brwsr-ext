# Installation (Windows, Chrome/Edge, unpacked)

## Prerequisites
- Windows 11, Chrome or Edge (stable), Rust 1.93.1 (for the host), and Node.js 24.3.0 (from `.node-version`).

## One-command install
```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```
What it does (no admin):
1. Builds release host (`cargo build --release --manifest-path native-host/Cargo.toml`).
2. Builds extension (`npm ci && npm run build` → `extension/dist/`).
3. Derives deterministic extension ID from `extension/dist/manifest.json` `key` via `scripts/get-extension-id.mjs`.
4. Copies `copyit-native-host.exe` to `%LOCALAPPDATA%\CopyIt Browser Extension\native-host\`.
5. Writes `com.quantdale.copyit.json` with absolute `path` and `allowed_origins: ["chrome-extension://<id>/"]`.
6. Registers `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.quantdale.copyit` and `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.quantdale.copyit`.
7. Runs `copyit-native-host --self-test` and prints the unpacked directory to load.

## Load unpacked
- Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `extension/dist`.
- Edge: `edge://extensions` → Developer mode → Load unpacked → select `extension/dist`.
Verify the ID matches `node scripts/get-extension-id.mjs`.

## Verify
```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify-install.ps1
```

## Dev install (uses target binary directly)
```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-install.ps1
```

## Uninstall (data survives)
```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
# %APPDATA%\CopyIt\copyit.db and *.legacy-backup-* are NOT deleted.
```
