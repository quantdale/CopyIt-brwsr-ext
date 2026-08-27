# CopyIt Native Protocol v1

The browser extension and the Rust native host (`com.quantdale.copyit`)
communicate over Chromium native messaging: UTF-8 JSON messages framed by a
32-bit **native-endian** length prefix on stdin/stdout. Host stdout is
protocol-only. Responses are capped at 900 KiB internally (below Chromium's
1 MB ceiling).

## Envelope

Request:

```json
{
  "protocolVersion": 1,
  "requestId": "any-opaque-string",
  "method": "listSnippets",
  "params": {}
}
```

Success response:

```json
{
  "protocolVersion": 1,
  "requestId": "same-id",
  "ok": true,
  "result": {}
}
```

Failure response:

```json
{
  "protocolVersion": 1,
  "requestId": "same-id",
  "ok": false,
  "error": { "code": "vault_locked", "message": "...", "retryable": false }
}
```

Rules:

- Unknown top-level request fields are rejected (`invalid_request`).
- `protocolVersion != 1` → `unsupported_protocol_version`.
- Unknown method → `unknown_method`; malformed params → `invalid_params`.
- `requestId` is echoed verbatim (max 128 chars).
- Error text is stable and user-safe: no paths, SQL, bodies, or passwords.
- `retryable` is true only for `database_busy` and `migration_in_progress`.

## Methods

### `hello` → health snapshot

```json
{ "protocolVersion": 1, "hostVersion": "0.1.0",
  "supportedSchemaVersion": 1, "dbSchemaVersion": 1 | null,
  "vaultState": "locked" | "unlocked" | "not_configured",
  "migrationStatus": "ready" | "migrated" | "seeded" | "failed",
  "dbReady": true, "lastErrorCode": "optional-on-failure" }
```

First call performs/observes legacy JSON→SQLite migration.

### `listCategories` → `{ categories: [{ name, count }] }`

Canonical categories with snippet counts, dropdown order preserved.

### `listSnippets`

Params: `{ query?, category?, offset?, limit? }` (limit default 100, hard cap
200; query/category length caps 512/256). Server-side SQL search across title,
description, category, plaintext body. Result metadata only:

```json
{ "items": [ { "id": 123, "title": "…", "description": "…",
               "category": "AI Prompt", "protected": false } ],
  "total": 42, "offset": 0, "pageSize": 100, "hasMore": false }
```

Titles are truncated at 500 UTF-8 bytes and descriptions at 2,000 UTF-8 bytes
(char-boundary-safe) in listings; full values remain in SQLite. Bodies and
ciphertext are NEVER included.

### `getSnippetBody` `{ id }` → `{ body }`

- missing id → `not_found`
- protected while vault locked → `vault_locked`
- decryption/authentication failure → `decrypt_failed` (never partial text)

### `unlockVault` `{ password }` → `{ vaultState: "unlocked" }`

Verifies via Argon2id + canary exactly as the desktop app. No vault configured
→ `vault_not_configured`. Wrong password → `invalid_password` with a small
bounded backoff after repeated failures. The derived key lives only in host
process memory and is zeroized on lock/disconnect/exit.

### `lockVault` → `{ vaultState: "locked" }`

Immediately zeroizes the session key.

### `ping` → `{ pong: true, hostVersion }`

Installer/integration smoke check.

## Error codes

`invalid_request`, `unsupported_protocol_version`, `unknown_method`,
`invalid_params`, `native_host_internal`, `migration_in_progress`*,
`migration_failed`, `legacy_data_corrupt`, `database_unavailable`,
`database_busy`*, `unsupported_schema_version`, `not_found`,
`vault_not_configured`, `vault_locked`, `invalid_password`, `decrypt_failed`,
`response_too_large` (* = retryable).

See `docs/protocol.md` for the complete narrative documentation and
`test-vectors/vault-vector.json` for the cross-repo crypto fixture both
repositories verify against.
