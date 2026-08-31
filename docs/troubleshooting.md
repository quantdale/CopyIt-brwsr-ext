# Troubleshooting

## Native host not installed or registered
Popup shows "CopyIt native host is not installed or registered." → Run `scripts/install.ps1` again, then `scripts/verify-install.ps1`. Check `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.quantdale.copyit` points to existing `com.quantdale.copyit.json`.

## Extension ID mismatch
`allowed_origins` must be `chrome-extension://<id>/` where `<id>` is `node scripts/get-extension-id.mjs extension/dist/manifest.json`. If you re-generated `.dev-extension-key.pem`, the ID changes — reinstall.

## Database busy / migration
Popup shows "Database is busy" → another process holds `migration.lock` or WAL. Retry. Check `%LOCALAPPDATA%\CopyIt\logs\native-host.log` (method, requestId, duration, error code only — no bodies/keys).

`migration_in_progress` and `database_busy` are transient initialization
failures. The native host does not cache them as terminal; retrying the next
popup request reattempts initialization through the same host process.
Corrupt legacy data, an unsupported schema, and deterministic migration
verification failures remain terminal until the underlying data is repaired.

## Unsupported schema
"Database schema is newer than this extension supports" → update extension + desktop to same release.

## Copy shows nothing / clipboard failed
Browser may block `clipboardWrite` in some contexts. Retry. Check console for `Clipboard write failed`.

## Vault locked / wrong password
`invalid_password` shows wrong-password message; retry. `vault_not_configured` means no vault — create one in desktop app first.

`unlockVault` has a 10 second timeout, separate from the 3.5 second timeout
used by normal reads. If the timeout expires, the popup checks `hello` before
deciding whether the vault is still locked. A successful native unlock is
accepted and the pending protected copy is retried once; otherwise the popup
reports that the unlock timed out and leaves the state truthful.

The vault password field uses `autocomplete="off"` to discourage browser
credential autofill for this application-specific secret. The field is cleared
after success, cancellation, and overlay dismissal. Password managers may still
override the browser hint.

## Corrupt legacy JSON
Migration preserves corrupt `snippets.json` as `snippets.json.legacy-backup-*` and refuses to seed over it. Fix or remove the backup, restart desktop.

## Logs
`%LOCALAPPDATA%\CopyIt\logs\native-host.log` — bounded to 256 KiB while the
host writes. Startup rotation replaces the single
`native-host.log.old` backup; if the backup cannot be replaced, the active log
is truncated so logging cannot silently defeat the bound. It never contains
bodies, passwords, keys, or ciphertext dumps.
