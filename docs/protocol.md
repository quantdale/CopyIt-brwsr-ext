# Protocol

See `protocol/README.md` for the normative v1 envelope.

## Framing
Each native message: 4-byte native-endian `u32` length + UTF-8 JSON. Host rejects oversize requests before allocation, decodes UTF-8, parses JSON, validates envelope, echoes `requestId` (≤128 chars), caps responses at 900 KiB, writes length + bytes, flushes stdout (protocol-only).

## Methods
`hello` (version, vaultState, migrationStatus, dbReady), `listCategories`, `listSnippets` (query/category/offset/limit, cap 200, LIKE ESCAPE `\`, metadata only), `getSnippetBody` (vault_locked/decrypt_failed), `unlockVault` (password, Argon2id+canary, zeroize, backoff), `lockVault`, `ping`.

## Errors
Stable codes: `invalid_request`, `unsupported_protocol_version`, `unknown_method`, `invalid_params`, `native_host_internal`, `migration_in_progress`*, `migration_failed`, `legacy_data_corrupt`, `database_unavailable`, `database_busy`*, `unsupported_schema_version`, `not_found`, `vault_not_configured`, `vault_locked`, `invalid_password`, `decrypt_failed`, `response_too_large` (* retryable). Never leak paths/SQL/bodies/passwords/keys.

## Origin defense
Host manifest `allowed_origins: ["chrome-extension://<deterministic-id>/"]` plus runtime origin-argument validation; never trust JSON-supplied origin.

## Logging
`%LOCALAPPDATA%\CopyIt\logs\native-host.log` — method, requestId, duration, error code, version only; no bodies/keys/ciphertext; rotated/capped.
