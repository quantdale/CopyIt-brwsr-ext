# Security

## Threat model (V1)
- Extension is read/search/copy/unlock only; no write/mutation, no site injection, no `activeTab`/`scripting`/`<all_urls>`.
- Canonical store is `%APPDATA%\CopyIt\copyit.db` (WAL). No live JSON/SQLite dual-write.
- Vault: Argon2id `m=19*1024 t=2 p=1 out=32`, XChaCha20Poly1305, nonce 24B, salt 16B, canary `copyit-vault-canary-v1`, base64 STANDARD. Host and desktop share identical params (proven by `protocol/test-vectors/vault-vector.json`).
- Host stdout is protocol-only; logs under `%LOCALAPPDATA%\CopyIt\logs\native-host.log` are bounded and contain only method, requestId, duration, error code, version — never bodies, passwords, derived keys, or ciphertext.
- `allowed_origins` is the deterministic extension ID; additionally the host validates `chrome.runtime.connectNative` origin argument. `allowed_origins` never uses `*`.
- `sensitive` note: V1 does not inject into websites (`activeTab` would be needed for direct paste — intentionally omitted).

## Permissions
`nativeMessaging`, `clipboardWrite` only.

## Native host
- Validates `protocolVersion == 1`, `requestId` echo, method, params.
- Caps responses at 900 KiB (< 1 MB browser limit).
- `listSnippets` never returns bodies/ciphertext; LIKE is parameterized with `ESCAPE '\'` and bound params.
- `getSnippetBody` refuses `vault_locked` until `unlockVault` succeeds; `invalid_password` has small backoff.
- Derived key zeroized on `lockVault`/disconnect/exit (`zeroize` crate).
