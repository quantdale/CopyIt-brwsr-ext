# Troubleshooting

## Native host not installed or registered
Popup shows "CopyIt native host is not installed or registered." → Run `scripts/install.ps1` again, then `scripts/verify-install.ps1`. Check `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.quantdale.copyit` points to existing `com.quantdale.copyit.json`.

## Extension ID mismatch
`allowed_origins` must be `chrome-extension://<id>/` where `<id>` is `node scripts/get-extension-id.mjs extension/dist/manifest.json`. If you re-generated `.dev-extension-key.pem`, the ID changes — reinstall.

## Database busy / migration
Popup shows "Database is busy" → another process holds `migration.lock` or WAL. Retry. Check `%LOCALAPPDATA%\CopyIt\logs\native-host.log` (method, requestId, duration, error code only — no bodies/keys).

## Unsupported schema
"Database schema is newer than this extension supports" → update extension + desktop to same release.

## Copy shows nothing / clipboard failed
Browser may block `clipboardWrite` in some contexts. Retry. Check console for `Clipboard write failed`.

## Vault locked / wrong password
`invalid_password` shows wrong-password message; retry. `vault_not_configured` means no vault — create one in desktop app first.

## Corrupt legacy JSON
Migration preserves corrupt `snippets.json` as `snippets.json.legacy-backup-*` and refuses to seed over it. Fix or remove the backup, restart desktop.

## Logs
`%LOCALAPPDATA%\CopyIt\logs\native-host.log` — bounded, rotated. Never contains bodies, passwords, keys, or ciphertext dumps.
