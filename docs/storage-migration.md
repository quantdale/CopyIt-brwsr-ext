# Storage & Migration

## Canonical store
`%APPDATA%\CopyIt\copyit.db` (WAL, `busy_timeout=3000`, `foreign_keys=ON`, `synchronous=NORMAL`).

## Schema v1
See `native-host/src/db.rs` and `protocol/README.md`. `schema_migrations` tracks version; hosts refuse `unsupported_schema_version`. `snippets(description TEXT, protection_*, sort_order, created_at, updated_at, CHECK body='' when protected)`, `categories(name COLLATE NOCASE)`, `app_config(singleton_id=1, theme, vault_salt, vault_canary)`, `migration_meta`.

## Migration
On first launch of new desktop or host, under `migration.lock` (fs2 exclusive):
1. If `copyit.db` exists → validate, migrate forward, integrity check, return.
2. Else locate legacy JSON via desktop rules, distinguish `Missing`/`Loaded`/`Corrupt`.
3. If no user data → seed defaults into fresh DB.
4. Else parse typed structs, normalize categories, preserve IDs/order/protection byte-for-byte, `description=NULL`, create `copyit.db.migrating.<pid>` with schema, single transaction, verify row counts/IDs/bodies/protection/categories/theme/vault + `integrity_check`/`foreign_key_check`, record `migration_meta` (timestamp, SHA-256 of source bytes), close, sync, atomic rename to `copyit.db`, reopen WAL, verify again.
5. Only then rename JSON sources to `*.legacy-backup-YYYYMMDD-HHMMSS` (numeric suffix if collision), never delete/overwrite. If rename fails, keep DB verified but warn.
6. Remove stale temp files only if unambiguously temp.

## Invariants
- One canonical library; no dual-write.
- Corrupt non-empty legacy file → `Corrupt`, never `Missing`; never seed over it.
- Ciphertext copied verbatim, not re-encrypted.
