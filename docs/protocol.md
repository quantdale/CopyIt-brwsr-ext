# Protocol

See `protocol/README.md` for the normative v1 envelope.

## Framing
Each native message: 4-byte native-endian `u32` length + UTF-8 JSON. Host rejects oversize requests before allocation, decodes UTF-8, parses JSON, validates envelope, echoes `requestId` (≤128 chars), caps responses at 900 KiB, writes length + bytes, flushes stdout (protocol-only).

## Methods
`hello` (version, vaultState, migrationStatus, dbReady), `listCategories`,
`listSnippets` (query/category/offset/limit, cap 200, LIKE ESCAPE `\`, metadata
only), `getSnippetBody` (vault_locked/decrypt_failed), `unlockVault` (password,
Argon2id+canary, zeroize, backoff), `lockVault`, `ping`.

## Errors
Stable codes: `invalid_request`, `unsupported_protocol_version`, `unknown_method`, `invalid_params`, `native_host_internal`, `migration_in_progress`*, `migration_failed`, `legacy_data_corrupt`, `database_unavailable`, `database_busy`*, `unsupported_schema_version`, `not_found`, `vault_not_configured`, `vault_locked`, `invalid_password`, `decrypt_failed`, `response_too_large` (* retryable). Only `migration_in_progress` and `database_busy` are retryable initialization failures; they are not cached as terminal process state. Never leak paths/SQL/bodies/passwords/keys.

## Origin defense
Host manifest `allowed_origins: ["chrome-extension://<deterministic-id>/"]` plus runtime origin-argument validation; never trust JSON-supplied origin.

## Logging
`%LOCALAPPDATA%\CopyIt\logs\native-host.log` — method, requestId, duration, error code, version only; no bodies/keys/ciphertext; rotated/capped.

## Browser-side envelope validation
`NativeClient` accepts a response only when it is an object with exact
`protocolVersion: 1`, a valid string `requestId`, boolean `ok`, and exactly the
matching `result` or `error` shape. A failure requires string `code` and
`message` fields plus boolean `retryable`. Malformed messages reject the
matching pending request, or all pending requests when no usable request ID is
available. Unsupported versions use the actionable message
`Native host protocol version is incompatible. Reinstall/update CopyIt.` Late
responses and unknown request IDs are ignored.

Normal requests time out after 3.5 seconds. `unlockVault` has a 10 second
budget because Argon2id and failure backoff can exceed the normal read budget.
When unlock times out, the popup asks `hello` for the authoritative vault state
before reporting failure.

`listSnippets` searches title, description, category, and plaintext bodies of
unprotected snippets. Protected bodies remain empty in the searchable column;
the host never decrypts the vault during list/search.
