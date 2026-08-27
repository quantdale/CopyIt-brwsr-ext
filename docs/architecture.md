# Architecture

## Overview
CopyIt browser extension shares one canonical SQLite store at `%APPDATA%\CopyIt\copyit.db` with the desktop app. The extension never writes prompts; it reads/searches/copies/unlocks via a Rust native messaging host (`com.quantdale.copyit`).

## Components
- **Extension popup** (`extension/src/popup.ts`): Manifest V3, plain DOM/CSS, Vite-built. Talks to host via `chrome.runtime.connectNative` long-lived port, not per-request spawning. Holds no vault key, no bodies in storage.
- **Native host** (`native-host/`): Rust, `rusqlite` bundled, Argon2id + XChaCha20Poly1305, `base64` standard, `zeroize`, `fs2` migration lock. Framing: 4-byte native-endian length + UTF-8 JSON, 900 KiB response cap, stdout protocol-only.
- **Protocol** (`protocol/`): version 1 envelope, typed error codes, `hello`/`listCategories`/`listSnippets` (search like %query% escape \)/`getSnippetBody`/`unlockVault`/`lockVault`/`ping`.
- **Shared SQLite** (`%APPDATA%\CopyIt\copyit.db`): `schema_migrations`, `snippets(id,title,description,category,body,protection_*,sort_order,created_at,updated_at)`, `categories(name,sort_order)`, `app_config(singleton_id=1,theme,vault_salt,vault_nonce,vault_canary)`, `migration_meta`. Pragmas: `foreign_keys=ON`, `busy_timeout=3000`, `journal_mode=WAL`, `synchronous=NORMAL`.
- **Migration** (`native-host/src/legacy.rs|migration.rs`, desktop `src/sqlite.rs`): cross-process `migration.lock` (fs2), JSON→SQLite verified (row counts, IDs, bodies, protection, categories, theme, vault, integrity_check, foreign_key_check), SHA-256 audit, atomic rename, `.legacy-backup-YYYYMMDD-HHMMSS` preserves source, idempotent.

## Data flow
Popup → `chrome.runtime.connectNative` → host stdin/stdout → SQLite read (WAL allows concurrent desktop writes). Bodies only on `getSnippetBody`. Vault key only in host memory, zeroized on `lockVault`/disconnect.

## Permissions
`nativeMessaging` + `clipboardWrite` only. No `tabs`/`activeTab`/`scripting`/`<all_urls>`.
