# CopyIt Browser Extension — One-Shot Implementation Plan

> **Status:** Approved implementation blueprint
>
> **Primary repository:** `quantdale/CopyIt-brwsr-ext`
>
> **Companion repository:** `quantdale/CopyIt`
>
> **Target:** Windows 11, Google Chrome and Microsoft Edge, Manifest V3, personal/unpacked installation
>
> **Execution mode:** This document is intentionally prescriptive. An implementation agent should be able to execute the complete project from this plan without stopping for routine product or architecture questions.

---

## 0. Executive objective

Build a personal-use CopyIt browser extension that turns the existing CopyIt prompt library into a compact browser-toolbar prompt picker.

The user should be able to:

1. Pin **CopyIt** beside the Chrome/Edge address bar.
2. Click the toolbar icon.
3. Immediately see a compact searchable list of prompt titles.
4. Hover or keyboard-focus a title/row to see an optional description in a tooltip.
5. Click a copy button to put the full prompt body on the clipboard.
6. For password-protected prompts, unlock the vault inside the popup for the lifetime of that popup/native-host session, then copy securely.
7. Close the popup without leaving prompt bodies, vault passwords, or derived vault keys in browser storage.

The browser extension and the existing CopyIt desktop application must share **one canonical prompt library**. Do **not** create a second browser-owned prompt database that needs synchronization.

The canonical store must move from the current `snippets.json` + `config.json` design to a SQLite database at:

```text
%APPDATA%\CopyIt\copyit.db
```

The existing JSON data must be migrated automatically and safely, with recoverable backups and no silent data loss.

---

# 1. Non-negotiable product decisions

These decisions are already made. Do not revisit them unless implementation evidence proves one impossible.

## 1.1 Extension UX

The popup is intentionally compact. A normal prompt row contains only:

```text
Prompt title                                      [copy]
```

No description preview is permanently rendered below the title.

If `description` is non-empty, show it in a custom tooltip when the row/title is hovered or keyboard-focused. The tooltip disappears when hover/focus leaves, on Escape, or when another row becomes active.

Do not use the native HTML `title` attribute as the primary tooltip implementation. Build an accessible custom tooltip so positioning, delay, width, keyboard behavior, and styling are deterministic.

The initial popup should resemble this density:

```text
┌─────────────────────────────────────────────┐
│ CopyIt                                      │
│ [ Search prompts…                      ]    │
│ [ All categories ▾ ]                       │
├─────────────────────────────────────────────┤
│ Next Campaign                         [⧉]   │
│ Deep Repo Audit                       [⧉]   │
│ Optimize Codebase                     [⧉]   │
│ OpenSpec Research                     [⧉]   │
│ Investigation Prompt                  [⧉]   │
│ Continue Agent                        [⧉]   │
└─────────────────────────────────────────────┘
```

Copy feedback should be transient and local to the clicked button, e.g. clipboard icon → check mark for roughly 700–1000 ms.

## 1.2 Description semantics

Add an optional `description` field to the canonical snippet model.

Rules:

- It is metadata explaining **what the prompt is for**.
- It is not a body preview.
- It is not displayed inline in the extension list.
- Empty or missing descriptions are valid.
- If a description is empty, do not show an empty tooltip.
- Existing snippets migrate with `description = NULL`/empty.
- Add a description field to the desktop CopyIt editor so the user can maintain it.
- Do not change the existing desktop card layout merely to expose the description; the desktop app can keep its current body-preview cards.

Recommended limits to keep the popup and native protocol bounded:

- title: existing behavior, but reject/pathologically truncate only at the UI layer if needed; do not destroy old data.
- description editor guidance: target <= 500 characters.
- native response: cap any description sent to the extension at 2,000 UTF-8 bytes after safe Unicode truncation. The full description may remain stored in SQLite if legacy/future data exceeds that.

## 1.3 Read-only browser surface

V1 browser functionality is **read/search/copy/unlock only**.

Do not add browser-side add/edit/delete/reorder operations in this implementation. The desktop app remains the authoritative editing surface. This keeps the native host API small and materially reduces security risk.

## 1.4 No direct website injection in V1

Do not request `activeTab`, broad host permissions, scripting permissions, or content scripts merely to paste directly into ChatGPT/Claude/etc.

Direct “Insert into current chat” can be a future feature. V1 should solve the requested workflow with reliable clipboard copy and minimal permissions.

## 1.5 Browser support

Required:

- Google Chrome stable on Windows
- Microsoft Edge stable on Windows
- Manifest V3
- unpacked/personal installation; no Chrome Web Store or Edge Add-ons publication required

Not required:

- Firefox
- Safari
- Linux/macOS native-host installers
- mobile browsers

## 1.6 Canonical storage

The canonical data source is SQLite, not `chrome.storage`, IndexedDB, or a second JSON file.

The extension must not persist prompt bodies in `chrome.storage.local`, `chrome.storage.sync`, LocalStorage, IndexedDB, Cache Storage, or service-worker caches.

The browser receives prompt bodies only on demand when Copy is requested.

---

# 2. Current-state compatibility contract

The existing desktop repository is `quantdale/CopyIt`.

At the time this plan was written it has these important characteristics that must be preserved:

- Rust 2021 desktop app using `eframe`/`egui` 0.27.
- `Snippet` currently contains `id`, `title`, `category`, `body`, and optional `protection`.
- Protected snippets use Argon2id + XChaCha20-Poly1305 and store ciphertext/nonce/hint while plaintext body is empty on disk.
- Vault metadata (KDF salt/canary) lives in config data.
- `%APPDATA%\CopyIt` is the stable user data directory.
- Current loaders distinguish `Loaded`, `Missing`, and `Corrupt`; **do not collapse corrupt into missing**.
- Current saves are atomic.
- Corrupt source files are preserved rather than overwritten.
- Categories are normalized/canonicalized.
- Desktop add/edit/delete/reorder actions autosave.
- The desktop repository has extensive Rust unit tests plus deterministic headless UI simulation journeys.
- CI treats Clippy warnings as errors.

The SQLite migration must preserve those behaviors, not merely preserve the happy-path values.

---

# 3. Repository ownership and workspace layout

## 3.1 `CopyIt-brwsr-ext` owns

This repository should contain:

```text
CopyIt-brwsr-ext/
├── AGENTS.md
├── README.md
├── IMPLEMENTATION_PLAN.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── eslint.config.*
├── vitest.config.*
├── playwright.config.*
├── extension/
│   ├── manifest.json
│   ├── popup.html
│   ├── src/
│   │   ├── popup.ts
│   │   ├── popup.css
│   │   ├── native-client.ts
│   │   ├── protocol.ts
│   │   ├── state.ts
│   │   ├── tooltip.ts
│   │   ├── clipboard.ts
│   │   └── dom.ts
│   ├── icons/
│   └── tests/
├── native-host/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── src/
│   │   ├── main.rs
│   │   ├── framing.rs
│   │   ├── protocol.rs
│   │   ├── db.rs
│   │   ├── legacy.rs
│   │   ├── migration.rs
│   │   ├── vault.rs
│   │   ├── logging.rs
│   │   └── origin.rs
│   └── tests/
├── protocol/
│   ├── README.md
│   ├── examples/
│   └── test-vectors/
├── scripts/
│   ├── build.ps1
│   ├── install.ps1
│   ├── uninstall.ps1
│   ├── verify-install.ps1
│   ├── dev-install.ps1
│   ├── get-extension-id.mjs
│   └── test-native-integration.ps1
├── tests/
│   ├── e2e/
│   └── fixtures/
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   ├── storage-migration.md
│   ├── installation.md
│   ├── troubleshooting.md
│   └── security.md
└── .github/
    └── workflows/
        ├── ci.yml
        └── windows-integration.yml
```

Exact filenames may change slightly if the toolchain requires it, but preserve the module boundaries.

## 3.2 `CopyIt` owns

The desktop repository remains responsible for:

- the egui GUI;
- desktop editing;
- desktop vault UX;
- desktop data mutation;
- desktop simulation tests;
- the desktop representation of the same SQLite schema.

The implementation agent must update `quantdale/CopyIt` in a coordinated branch so it reads and writes the same `copyit.db` contract.

## 3.3 One-shot workspace behavior

When executing this plan:

1. Start from fresh/latest `main` in both repositories.
2. In this repo, create a feature branch such as:
   `feature/copyit-browser-extension-v1`.
3. Locate the desktop repo as a sibling directory (`../CopyIt`) if already available.
4. If it is not available, clone `https://github.com/quantdale/CopyIt.git` into a sibling workspace, **not inside this repository**.
5. Create a coordinated desktop branch such as:
   `feature/sqlite-browser-extension-compat`.
6. Do not mix the two repositories' Git histories.
7. Do not stop after scaffolding one repo. Complete and validate both sides in the same execution session.

---

# 4. Technology choices

## 4.1 Browser extension

Use:

- Manifest V3
- TypeScript
- plain DOM/CSS; **no React/Vue/Svelte** for this small popup
- `chrome.*` APIs so the same build runs in Chromium-based Chrome and Edge
- a minimal bundler such as esbuild or Vite; prefer the least-complex setup that creates deterministic static output
- Vitest for TypeScript unit/DOM tests
- Playwright for popup E2E tests

Do not add a UI framework solely for a dozen rows and a tooltip.

## 4.2 Native host

Use Rust.

Recommended dependencies:

- `serde`, `serde_json`
- `rusqlite` with bundled SQLite to avoid a system SQLite dependency
- `argon2`
- `chacha20poly1305`
- `base64`
- `zeroize`
- `rand`/`rand_core` only as needed by compatibility code/tests
- a small file-lock crate such as `fs2` for migration locking
- `thiserror` if it materially improves typed error handling

Avoid heavyweight async runtimes. Native messaging is sequential stdin/stdout framing and does not require Tokio.

## 4.3 Native Messaging basis

The implementation must follow Chromium native messaging semantics:

- extension manifest requests `nativeMessaging`;
- native-host manifest names a native executable, uses `type: "stdio"`, and restricts `allowed_origins`;
- browser launches the host and communicates over stdin/stdout;
- each message is UTF-8 JSON preceded by a 32-bit native-endian length;
- host stdout is protocol-only, never logs;
- keep every host→browser message comfortably below Chromium's 1 MB response ceiling.

Useful references:

- Chrome runtime/native messaging: https://developer.chrome.com/docs/extensions/reference/api/runtime
- Chrome extension actions/popups: https://developer.chrome.com/docs/extensions/reference/api/action
- Chrome manifest format: https://developer.chrome.com/docs/extensions/reference/manifest
- Edge native messaging: https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging

---

# 5. SQLite design

## 5.1 Database location

Canonical path:

```text
%APPDATA%\CopyIt\copyit.db
```

Keep the existing `%APPDATA%\CopyIt` location so users do not have to discover a new data directory.

## 5.2 Connection pragmas

For normal desktop/native-host access, initialize each connection with:

```sql
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 3000;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

Only enable additional pragmas when justified by tests. Do not use unsafe performance settings (`synchronous=OFF`, etc.).

For the temporary one-time migration database, prefer a rollback journal until the final file is atomically installed, then enable WAL after reopening the canonical file. This avoids having to atomically install a `.db` plus transient WAL/SHM companions during migration.

## 5.3 Schema versioning

Never infer schema from the presence of columns.

Create a migrations table:

```sql
CREATE TABLE schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    applied_at  TEXT NOT NULL
);
```

Initial schema version: `1`.

Every future schema change must be a forward migration. Both repositories must know the maximum schema version they support. If the native host encounters a DB newer than it supports, return a clear `unsupported_schema_version` error instead of guessing.

## 5.4 Initial schema

Use an initial schema equivalent to:

```sql
CREATE TABLE snippets (
    id                      INTEGER PRIMARY KEY,
    title                   TEXT NOT NULL,
    description             TEXT,
    category                TEXT NOT NULL,
    body                    TEXT NOT NULL DEFAULT '',
    protection_hint         TEXT,
    protection_nonce        TEXT,
    protection_ciphertext   TEXT,
    sort_order              INTEGER NOT NULL,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL,

    CHECK (
      (protection_hint IS NULL AND protection_nonce IS NULL AND protection_ciphertext IS NULL)
      OR
      (protection_hint IS NOT NULL AND protection_nonce IS NOT NULL AND protection_ciphertext IS NOT NULL AND body = '')
    )
);

CREATE INDEX idx_snippets_sort_order
    ON snippets(sort_order, id);

CREATE INDEX idx_snippets_category
    ON snippets(category COLLATE NOCASE);

CREATE TABLE categories (
    name       TEXT PRIMARY KEY COLLATE NOCASE,
    sort_order INTEGER NOT NULL
);

CREATE TABLE app_config (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    theme        TEXT NOT NULL,
    vault_salt   TEXT,
    vault_canary TEXT,
    CHECK (
      (vault_salt IS NULL AND vault_canary IS NULL)
      OR
      (vault_salt IS NOT NULL AND vault_canary IS NOT NULL)
    )
);

CREATE TABLE migration_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

Adjust names for idiomatic implementation, but preserve the semantics.

### Notes

- Do not make `sort_order` unique. Reorders are easiest to update in one transaction without transient uniqueness collisions.
- Existing IDs must survive migration exactly.
- `description` is nullable for clean backward migration.
- Existing plaintext bodies remain plaintext unless a snippet was already protected.
- Existing protected ciphertext/nonce/hint must be copied byte-for-byte as base64 text. Do not decrypt/re-encrypt merely to migrate formats.
- `created_at`/`updated_at` for legacy rows can both be set to the migration timestamp because old JSON has no timestamps.
- New desktop inserts should set both timestamps; edits should change `updated_at`.

## 5.5 Search behavior

The native host should perform server-side search so bodies do not need to be sent to the browser.

For V1, parameterized SQL using case-insensitive `LIKE` is sufficient. Search across:

- title
- description
- category
- plaintext body

Encrypted bodies cannot be searched while locked because plaintext does not exist in the DB; title/description/category remain searchable.

Do not add FTS5 unless profiling shows ordinary parameterized search is inadequate. The first version should remain simple and reliable.

---

# 6. Legacy JSON → SQLite migration

This is a critical path. Treat migration correctness as more important than implementation speed.

## 6.1 Legacy sources

The existing files are normally:

```text
%APPDATA%\CopyIt\snippets.json
%APPDATA%\CopyIt\config.json
```

The desktop repo also knows older legacy candidate locations. Preserve its current legacy discovery behavior before performing the JSON→SQLite conversion.

## 6.2 Migration coordination lock

Both the updated desktop app and native host may be the first new binary launched.

Use a cross-process exclusive migration lock file such as:

```text
%APPDATA%\CopyIt\migration.lock
```

Rules:

1. Acquire exclusive lock before creating/migrating `copyit.db`.
2. If another process holds it, wait with bounded backoff and then re-check whether the DB has become valid.
3. Never have two processes independently import the same JSON concurrently.
4. Release the lock on all exit paths.

## 6.3 Migration algorithm

Implement the following exact high-level algorithm:

1. Resolve/create `%APPDATA%\CopyIt` using the desktop app's existing stable-location semantics.
2. Acquire migration lock.
3. If `copyit.db` exists:
   - open it;
   - validate SQLite header/openability;
   - run supported forward migrations;
   - run a lightweight integrity/schema check;
   - return it as canonical;
   - **do not re-import JSON**.
4. If DB does not exist, locate legacy JSON using the existing desktop migration rules.
5. Read legacy files with the same semantic distinction as today:
   - missing/empty → no user data;
   - valid → candidate import;
   - corrupt/unreadable → preserve and surface error; do not silently seed over it.
6. If there is genuinely no user data, create a fresh SQLite DB populated with the same default seeded snippets/config the desktop app would create.
7. If valid legacy data exists:
   - parse into typed legacy structs;
   - normalize/sanitize config using current desktop semantics;
   - preserve all snippet IDs and ordering;
   - preserve exact protected payloads;
   - set description to NULL;
   - create a temporary DB beside the final path, e.g. `copyit.db.migrating.<pid>`;
   - create schema and insert everything in a single transaction.
8. Before committing/installing the migrated DB, verify:
   - row count equals legacy snippet count;
   - IDs exactly match;
   - title/category/body exactly match plaintext sources;
   - protection hint/nonce/ciphertext exactly match protected sources;
   - protected rows still have empty body;
   - category set matches canonicalized legacy config;
   - theme matches;
   - vault salt/canary match exactly;
   - `PRAGMA integrity_check` returns `ok`;
   - `PRAGMA foreign_key_check` returns no rows.
9. Record migration metadata, including migration timestamp and SHA-256 hashes of the source JSON bytes. The hashes are for audit/recovery only; never contain passwords/plaintext beyond what is already in the source.
10. Commit and close the temporary database.
11. Flush/sync the temporary DB file to disk as practical on Windows.
12. Atomically rename/move it to `copyit.db`.
13. Reopen `copyit.db`, enable WAL, and verify it again.
14. Only after the canonical DB is valid, preserve the source JSON files as uniquely named backups, e.g.:

```text
snippets.json.legacy-backup-20260826-190200
config.json.legacy-backup-20260826-190200
```

15. Never overwrite an existing backup; add a numeric suffix if necessary.
16. If backup renaming fails, do **not** delete the JSON. The DB can remain canonical if it has already been fully verified, but report the backup warning clearly.
17. Remove stale temporary migration files only when they are unambiguously temp artifacts and not the only surviving user data.

## 6.4 Failure rules

- Any parse failure in a non-empty legacy user file is a migration error, not “first run.”
- Never replace a corrupt legacy file with seed data.
- Never delete legacy JSON during migration.
- Never modify ciphertext in-place.
- A failed temp DB must not replace a valid old JSON source.
- On migration failure, preserve enough error context for troubleshooting but do not log prompt bodies.

## 6.5 Downgrade behavior

After successful migration, old CopyIt builds that understand only JSON are unsupported unless the user manually restores the legacy backup.

Document this clearly. Do not maintain live dual-write JSON+SQLite compatibility; dual writing creates two sources of truth and introduces exactly the synchronization problem this project is meant to eliminate.

---

# 7. Desktop `CopyIt` changes

Implement coordinated changes in `quantdale/CopyIt`.

## 7.1 Model

Extend `Snippet` with optional/empty description while preserving serialization compatibility for any migration tests that still use JSON structs.

Conceptually:

```rust
pub struct Snippet {
    pub id: u64,
    pub title: String,
    pub description: String,
    pub category: String,
    pub body: String,
    pub protection: Option<Protection>,
}
```

If legacy JSON deserializes directly into this struct, use `#[serde(default)]` on description.

## 7.2 Persistence seam

Preserve the existing architectural separation: app/UI code should not manipulate filesystem or SQL paths directly.

Refactor the store layer so the application works through explicit persistence methods.

Preferred interface shape:

```text
Store::open()
Store::load_snapshot()
Store::insert_snippet(...)
Store::update_snippet(...)
Store::delete_snippet(id)
Store::persist_order(...)
Store::load_config()
Store::save_config(...)
```

A complete `save_all_snippets()` helper may remain for migration/tests, but normal desktop edits should use transactional row-level operations rather than serializing and rewriting the whole library.

All mutations must be transactions and must surface errors to the existing UI error mechanism.

## 7.3 Reordering

When drag-and-drop changes ordering:

1. update in-memory order as today;
2. persist `sort_order` for affected/all rows in one SQLite transaction;
3. rollback/report if persistence fails;
4. ensure filtering does not corrupt canonical order.

The simplest correct approach is to write `sort_order = array_index` for the entire current vector in one transaction. This is still far cheaper/safer than rewriting prompt bodies and avoids complex partial-reorder bugs.

## 7.4 Desktop editor

Add an optional Description control to the Add/Edit modal.

Guidelines:

- label: `Description (optional)`;
- multiline or 1–3 line field;
- suitable for a short explanation of what the snippet/prompt does;
- do not make it required;
- do not display it as a permanent second line on cards unless later requested;
- include it in desktop search if doing so does not break current caching architecture;
- update derived/filter cache invalidation to account for description changes.

## 7.5 Desktop search/cache

Current CopyIt caches lowercased title/body/category data. Add normalized/lowercased description to the derived cache and include it in search matching.

Ensure library generation/cache invalidation happens when description changes.

## 7.6 Vault compatibility

Do not change the crypto algorithm, KDF parameters, nonce format, base64 format, hint semantics, or canary semantics as part of this project.

The browser native host must be compatible with existing encrypted rows, not vice versa.

## 7.7 Desktop test updates

Extend existing unit/simulation coverage for:

- SQLite open/create;
- schema migration versioning;
- valid JSON import;
- missing JSON fresh seed;
- zero-byte JSON behavior;
- corrupt JSON preservation;
- protected snippet migration;
- config/vault migration;
- exact ID/order preservation;
- description add/edit persistence;
- category persistence;
- reorder persistence;
- concurrent read while desktop writes (WAL);
- migration idempotency;
- interrupted/stale temp migration recovery;
- unsupported future schema behavior;
- save error reporting;
- all existing simulation journeys still passing after persistence refactor.

Run the repository's full existing gates, including Clippy with warnings denied and serial simulation journeys.

---

# 8. Native host design

## 8.1 Host identity

Use a stable native host name such as:

```text
com.quantdale.copyit
```

It must satisfy Chrome/Edge native host naming restrictions.

## 8.2 Process lifetime

The popup should call:

```text
chrome.runtime.connectNative("com.quantdale.copyit")
```

instead of spawning a fresh native host for every request.

This gives a single host process for the popup lifetime and enables a sensible vault model:

- popup opens → host process starts;
- vault starts locked;
- user may unlock → derived key exists only in host memory;
- multiple protected copies can occur while popup remains open;
- popup closes/port disconnects → host process exits → derived key is dropped/zeroized.

No always-running Windows background service is required.

## 8.3 Framing

Rust framing module requirements:

1. Read exactly four bytes for message length.
2. Interpret as native-endian `u32` (Windows is little-endian; use platform-correct conversion, do not hand-wave partial reads).
3. Reject absurd/internally over-limit messages before allocating.
4. Read exactly that many bytes.
5. Decode UTF-8.
6. Parse JSON.
7. Serialize response JSON.
8. Verify response is below the internal response cap.
9. Write 4-byte length + bytes.
10. Flush stdout.

Set an internal host→extension maximum below the browser limit, e.g. ~900 KiB.

Never use `println!`, `dbg!`, or logging to stdout. stdout is protocol-only.

## 8.4 Protocol envelope

Version the protocol from day one.

Request:

```json
{
  "protocolVersion": 1,
  "requestId": "uuid-or-monotonic-id",
  "method": "listSnippets",
  "params": {}
}
```

Success:

```json
{
  "protocolVersion": 1,
  "requestId": "same-id",
  "ok": true,
  "result": {}
}
```

Failure:

```json
{
  "protocolVersion": 1,
  "requestId": "same-id",
  "ok": false,
  "error": {
    "code": "vault_locked",
    "message": "Vault is locked",
    "retryable": true
  }
}
```

Do not expose Rust backtraces, filesystem internals, SQL statements, prompt bodies, or passwords in normal protocol errors.

## 8.5 Required methods

### `hello`

Returns at least:

- protocol version
- native host version
- supported DB schema version
- current DB schema version
- `vaultState: "locked" | "unlocked" | "not_configured"`
- migration/health status needed by UI

Do not return the full DB path to the extension unless needed for diagnostics; path disclosure is unnecessary for normal UI.

### `listCategories`

Returns canonical categories.

### `listSnippets`

Params:

```json
{
  "query": "optional string",
  "category": "optional exact canonical category",
  "offset": 0,
  "limit": 100
}
```

Rules:

- hard cap `limit`, e.g. 200;
- stable order by `sort_order, id`;
- search is performed in SQLite;
- result returns metadata only;
- **never include prompt body or ciphertext in list results**.

Item shape:

```json
{
  "id": 123,
  "title": "Next Campaign",
  "description": "Determine the next high-value repository campaign.",
  "category": "AI Prompt",
  "protected": false
}
```

Also return `total` or `hasMore` so popup pagination is deterministic.

### `getSnippetBody`

Params: snippet ID.

Behavior:

- missing ID → `not_found`;
- plaintext → return body;
- protected + vault locked → `vault_locked`;
- protected + unlocked → decrypt in host memory and return plaintext body;
- decryption/authentication failure → `decrypt_failed`, never return partial text.

After the extension successfully writes to clipboard, it must drop references to the body as quickly as practical.

### `unlockVault`

Params: password.

Behavior:

- if no vault configured, return a clear state; browser does not create a new vault in V1;
- derive key using exactly the desktop parameters;
- verify canary exactly as desktop does;
- keep derived key only in host process memory;
- use `zeroize` where possible;
- clear password buffers/references promptly;
- on failure, return `invalid_password` without distinguishing useful crypto internals;
- add a small in-process delay/backoff after repeated failures to avoid accidental rapid retries.

### `lockVault`

Immediately zeroizes/drops the host key and returns locked state.

### `ping` / `health`

Provide a minimal diagnostic method used by installer/integration tests.

## 8.6 Origin defense

The native-host manifest must restrict `allowed_origins` to this extension's deterministic ID.

Additionally, inspect the origin argument passed by Chrome/Edge at host startup and reject unexpected origins before servicing data requests.

Do not accept an origin supplied inside JSON as authoritative.

## 8.7 Native host DB permissions

The protocol exposes no write/mutation methods in V1.

The host may need write capability only to perform/finish first-time schema/legacy migration. Once initialization is complete, normal prompt access should be logically read-only.

Never accept an arbitrary path from the browser to tell the host what DB/file to open.

## 8.8 Logging

If file logging is implemented, use a bounded log under a location such as:

```text
%LOCALAPPDATA%\CopyIt\logs\native-host.log
```

Requirements:

- no prompt bodies;
- no vault passwords;
- no derived keys;
- no decrypted protected text;
- no full ciphertext dumps;
- log request method, request ID, duration, safe error code, and version information only;
- rotate/cap logs so a tiny utility cannot grow indefinitely.

---

# 9. Vault cross-compatibility tests

The native host duplicates the desktop vault algorithm, so compatibility must be proven with test vectors.

Create a small committed fixture under `protocol/test-vectors/` containing **synthetic non-secret** values only:

- known password such as `correct horse battery staple` used only for tests;
- fixed KDF salt;
- fixed nonce;
- known plaintext test prompt;
- expected canary/ciphertext/hint.

Generate/verify the vector through the desktop implementation and independently verify it through the native-host implementation.

Tests must prove:

1. desktop-encrypted fixture decrypts in native host;
2. native-host-compatible algorithm yields expected canary verification;
3. wrong password fails;
4. tampered ciphertext fails authentication;
5. nonce/ciphertext base64 parsing rejects malformed data safely.

Do not weaken production nonce randomness just to obtain deterministic tests; test-only helpers may accept fixed nonce/key inputs.

---

# 10. Extension Manifest V3 design

## 10.1 Minimal permissions

Expected permission set:

```json
{
  "permissions": [
    "nativeMessaging",
    "clipboardWrite"
  ]
}
```

Do not add `tabs`, `activeTab`, `scripting`, `<all_urls>`, history, bookmarks, or host permissions for V1.

If modern `navigator.clipboard.writeText` functions reliably in extension popup context without `clipboardWrite` in all target browsers, verify that behavior before removing the permission. Prefer reliability over cleverness, but keep permissions minimal.

## 10.2 Action popup

Use Manifest V3 `action.default_popup`.

No background service worker is required unless the implementation genuinely needs lifecycle coordination that cannot occur in the popup itself.

Native messaging is allowed from extension pages such as the popup, so avoid introducing a service worker merely as a relay.

## 10.3 Deterministic extension ID

Native Messaging `allowed_origins` requires a stable extension ID.

During implementation:

1. generate a development extension key once using a supported Chrome packaging workflow;
2. commit only the public manifest `key` value, never the private `.pem`;
3. add private key files to `.gitignore`;
4. add `scripts/get-extension-id.mjs` that derives/verifies the extension ID from the committed manifest key;
5. use that derived ID when generating the native-host manifest;
6. verify Chrome and Edge load the same unpacked build under the expected deterministic ID.

Do not hardcode a guessed extension ID without a test/script proving it matches the manifest key.

---

# 11. Popup UI behavior

## 11.1 Dimensions and layout

Target roughly 400–460 px width and a maximum height that fits normal extension popup constraints. Allow the list itself to scroll.

Structure:

1. compact header/title;
2. search input;
3. category filter;
4. scrollable prompt rows;
5. status/error/unlock overlays only when needed.

Avoid ornamental dashboard UI. This is a speed tool.

## 11.2 Prompt row

Each row should expose:

- title, ellipsized if necessary;
- one copy icon button;
- optional subtle protected/lock affordance if it helps users understand why copying may request a password;
- tooltip only if description exists.

The body must never be rendered into the row or DOM as a hidden preview.

## 11.3 Tooltip

Requirements:

- appears after a short hover delay (~200–300 ms);
- appears on keyboard focus;
- uses `role="tooltip"`;
- target gets `aria-describedby` only while appropriate;
- max width around 280–340 px;
- supports multiline text;
- clamps/positions inside popup viewport;
- cannot block the copy button;
- disappears on pointer leave, blur, Escape, row replacement, or popup close;
- no tooltip for missing/empty description;
- sanitize by assigning text through `textContent`, never `innerHTML`.

Test edge positioning on first/last rows and near the right edge.

## 11.4 Search

- Autofocus search on popup open if it does not create annoying Chrome behavior; otherwise focus predictably on first Tab.
- Debounce server-side search around 100–150 ms.
- Search title/description/category/plaintext body via native host SQL.
- Ignore stale responses using request IDs/query generation.
- Preserve category filter while searching.
- Empty query returns canonical order.

Optional keyboard convenience: `/` or Ctrl+K focuses search, provided it does not conflict with typing or accessibility.

## 11.5 Pagination

Do not return the entire library with bodies.

For metadata:

- page size ~100;
- maximum host page size ~200;
- initial page loads immediately;
- fetch next page near scroll bottom or via a small `Load more` mechanism;
- changing search/category cancels/discards stale page state and starts at offset 0.

This keeps native messages far below the 1 MB ceiling even with large libraries.

## 11.6 Copy flow — plaintext

1. User clicks Copy.
2. Disable/reentrancy-guard that row's copy button.
3. Request `getSnippetBody(id)`.
4. Receive body.
5. Call clipboard API.
6. Clear local body reference as soon as possible.
7. Show checkmark success for ~800 ms.
8. Restore icon/button.
9. On clipboard failure, show a concise row/global error and do not claim success.

## 11.7 Copy flow — protected

1. User clicks Copy on protected snippet.
2. Host returns `vault_locked` if not unlocked.
3. Popup opens a compact password dialog/overlay.
4. Password field is `type=password`; disable autocomplete as appropriate.
5. Submit calls `unlockVault`.
6. Invalid password shows concise error and retains focus.
7. Successful unlock closes dialog and automatically retries the original copy exactly once.
8. Host returns decrypted body.
9. Clipboard write occurs.
10. Extension discards body reference.
11. Host key remains in memory only while native port/popup lives.
12. Provide a small lock control/status only while unlocked if it can fit without clutter; alternatively lock on popup close is sufficient. If a lock control is present, it calls `lockVault`.

Never put the password in DOM attributes, logs, query strings, storage, or error messages.

## 11.8 Host-unavailable state

If `connectNative` fails because the host is not registered/installed:

- show a compact explanation: `CopyIt native host is not installed or registered.`
- provide a short path to `docs/installation.md` in developer builds or textual command/instruction;
- do not loop/retry rapidly;
- allow a manual Retry button.

## 11.9 Other states

Handle explicitly:

- loading;
- empty library;
- no search matches;
- DB migration required/failed;
- unsupported DB schema;
- database busy/temporarily unavailable;
- native host protocol mismatch;
- clipboard failure;
- invalid vault password;
- corrupt protected payload.

Never silently fall back to stale browser-cached prompts.

---

# 12. Extension state and data minimization

Keep canonical data in native SQLite only.

In the popup, keep only:

- current metadata page(s);
- current query/filter;
- temporary UI state;
- body for the milliseconds needed to write clipboard;
- never the vault key.

Do not persist prompt data across popup lifetimes.

If UI preferences eventually need persistence, they may use browser storage, but no such preference is required for V1.

---

# 13. Native-host installation and registration

Because this is a personal unpacked extension, optimize for a reliable developer/personal install rather than store distribution.

## 13.1 Install location

Recommended per-user host location:

```text
%LOCALAPPDATA%\CopyIt Browser Extension\native-host\
    copyit-native-host.exe
    com.quantdale.copyit.json
```

Do not require administrator privileges.

## 13.2 Registry

Register the native host for the current user:

Chrome:

```text
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.quantdale.copyit
```

Edge:

```text
HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.quantdale.copyit
```

Default registry value is the absolute path to the native-host manifest JSON.

## 13.3 Generated native-host manifest

Generate rather than hand-maintain absolute paths.

Conceptually:

```json
{
  "name": "com.quantdale.copyit",
  "description": "Native bridge for the CopyIt browser extension",
  "path": "C:\\Users\\...\\copyit-native-host.exe",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://<deterministic-extension-id>/"
  ]
}
```

## 13.4 `scripts/install.ps1`

Must:

1. fail fast with useful errors;
2. build or locate the release native host;
3. build the extension;
4. derive the extension ID from the manifest key;
5. copy native-host binary to per-user install location;
6. write native-host manifest with absolute executable path;
7. register Chrome and Edge HKCU keys if those browsers are present (registering both harmlessly is acceptable);
8. run host `--self-test`/health check without native framing;
9. print the exact unpacked extension directory to load;
10. print concise Chrome and Edge developer-mode steps;
11. optionally open `chrome://extensions` / `edge://extensions` after asking via a switch or with a documented option, not unexpectedly during CI;
12. require no admin rights.

## 13.5 `scripts/dev-install.ps1`

Developer convenience may register the host manifest against `target\release\copyit-native-host.exe` rather than copying it, but document that rebuilding/moving workspace can break that registration.

## 13.6 `scripts/uninstall.ps1`

Must remove:

- Chrome native-host registry key;
- Edge native-host registry key;
- installed native-host executable/manifest/logs owned by this extension installer.

Must **not** delete:

```text
%APPDATA%\CopyIt\copyit.db
```

or legacy backups. User data survives uninstall.

## 13.7 `scripts/verify-install.ps1`

Check:

- extension build exists;
- manifest parses;
- deterministic extension ID is expected;
- host executable exists;
- host manifest parses and path exists;
- allowed origin matches extension ID;
- Chrome registry entry is correct if Chrome installed;
- Edge registry entry is correct if Edge installed;
- host self-test passes;
- DB open/schema health is valid or clearly reports first-run migration state.

Return nonzero on actual failure so an agent/CI can use it as a gate.

---

# 14. Native host CLI diagnostics

The host binary should support normal native-messaging mode by default plus explicit developer diagnostics that do not use stdout framing accidentally.

Recommended switches:

```text
--self-test
--version
--print-data-dir
--check-db
--migrate-only
```

When a diagnostic switch is present, stdout may be human-readable because the browser did not launch it as a native host. In native mode, stdout remains protocol-only.

Do not add an HTTP server or background daemon.

---

# 15. Extension/native protocol test strategy

## 15.1 Rust unit tests

Cover at minimum:

### Framing

- one valid message;
- multiple sequential messages;
- partial read behavior;
- EOF before 4-byte length;
- EOF mid-payload;
- invalid UTF-8;
- invalid JSON;
- oversized request rejection;
- oversized response prevention.

### Protocol

- unknown protocol version;
- unknown method;
- missing params;
- request ID echoed exactly;
- typed/safe errors;
- no body in `listSnippets` response.

### DB

- create v1 schema;
- migration table version;
- list ordering;
- filter/search;
- pagination boundaries;
- category filtering;
- body lookup;
- protected/body constraint;
- unsupported future schema.

### Legacy migration

All cases from section 6.

### Vault

All cross-compatibility vectors from section 9.

## 15.2 Host subprocess integration test

Create a test harness that spawns the compiled host as a child with pipes, sends real framed requests, and reads framed responses against a temporary APPDATA fixture.

This is the closest test to what Chromium does without requiring a browser.

Test a scenario:

1. valid legacy JSON fixture exists;
2. start host;
3. `hello` triggers/observes migration;
4. list prompts;
5. fetch plaintext body;
6. fetch protected body → locked;
7. unlock with test password;
8. fetch protected body successfully;
9. lock;
10. protected fetch fails locked again;
11. host exits cleanly when stdin closes.

## 15.3 TypeScript tests

Test:

- native-client request/response correlation;
- connect/disconnect errors;
- stale search response suppression;
- pagination reset when query changes;
- tooltip hover delay;
- tooltip keyboard focus;
- tooltip Escape dismissal;
- tooltip safe text rendering (HTML-like description stays text);
- no tooltip when description empty;
- copy success icon timing;
- clipboard failure state;
- protected copy unlock/retry flow;
- invalid password flow;
- host-unavailable UI;
- unsupported protocol/schema UI.

Use dependency injection for native transport and clipboard so tests do not require a real browser host.

## 15.4 Browser E2E with mock transport

Use Playwright to load the built unpacked extension and exercise the real popup DOM/CSS with a deterministic mock native client or test hook compiled only for test builds.

Required E2E journeys:

1. popup loads dense title-only list;
2. hover title → description tooltip;
3. move away → tooltip gone;
4. keyboard Tab to row → tooltip accessible;
5. search filters results;
6. category filter works;
7. copy calls clipboard abstraction and shows success;
8. protected copy opens unlock UI;
9. wrong password error;
10. correct password auto-retries copy;
11. long titles ellipsize without pushing copy button offscreen;
12. long tooltip stays within popup bounds;
13. 100+ results scroll/paginate cleanly;
14. no-results/empty/host-error states render correctly.

## 15.5 Windows real native integration

`scripts/test-native-integration.ps1` should, when Chrome/Edge is available:

1. build extension and host;
2. create an isolated temp APPDATA/fixture DB or legacy JSON;
3. generate/register a temporary HKCU native-host manifest for the deterministic extension ID;
4. launch a browser persistent context with the unpacked extension;
5. exercise at least `hello`, list, copy-body retrieval, protected unlock, and disconnect;
6. restore/remove temporary registry entries even on failure;
7. never touch the user's real CopyIt data during tests.

If browser automation cannot safely isolate APPDATA from the native host process, add an explicit test-only environment variable accepted only in debug/test builds to override the data directory. Production release builds must ignore/reject arbitrary browser-supplied paths.

---

# 16. Performance expectations

This is a local personal utility; optimize for instant perceived response without premature complexity.

Create synthetic fixtures with at least:

- 100 prompts;
- 1,000 prompts;
- 10,000 prompts including long bodies.

Targets on a normal modern Windows laptop:

- popup shell paints immediately while host connects;
- native host cold start + first 100 metadata rows should normally complete well under 1 second and target ~500 ms or better;
- once connected, title search over 10k rows should target <100 ms locally;
- copying a normal plaintext prompt should feel immediate after click;
- extension initial response must never contain all prompt bodies;
- host memory usage should remain small and bounded by page/body request size, not the total library body size.

Do not block release solely because a noisy CI VM misses a strict millisecond threshold. Treat these as profiling/engineering targets and fail only on obvious regressions or unbounded behavior.

---

# 17. Security requirements

## 17.1 Data exposure

- no prompt bodies in list responses;
- no prompt bodies in browser storage;
- no prompt bodies in logs;
- no passwords in logs;
- no derived vault keys outside native host memory;
- no remote network calls required for core functionality;
- no analytics/telemetry;
- no remote scripts.

## 17.2 Browser permissions

Keep permissions minimal. Any permission beyond `nativeMessaging` and clipboard capability must be justified in documentation and code review.

## 17.3 SQL

Use bound parameters everywhere. Never interpolate query/category/user strings into SQL.

## 17.4 Native origin

Use both:

1. native-host `allowed_origins`;
2. runtime origin argument validation.

## 17.5 Protocol abuse

- validate protocol version;
- validate method names;
- cap string lengths where relevant;
- cap page size;
- cap frame size;
- reject unknown/invalid structures;
- do not permit arbitrary file access;
- do not permit shell execution;
- do not expose write methods in V1.

## 17.6 Vault lifecycle

- host starts locked every process;
- no password caching;
- no browser-side key derivation;
- derived key zeroized/dropped on lock/disconnect/exit;
- decryption only after canary-verified unlock;
- auth failure never returns partial plaintext.

---

# 18. Error-code contract

Define stable machine-readable errors. At minimum:

```text
invalid_request
unsupported_protocol_version
unknown_method
invalid_params
native_host_internal
migration_in_progress
migration_failed
legacy_data_corrupt
database_unavailable
database_busy
unsupported_schema_version
not_found
vault_not_configured
vault_locked
invalid_password
decrypt_failed
response_too_large
```

TypeScript should map these to concise user-facing text without exposing internal implementation details.

Document which errors are retryable.

---

# 19. CI and quality gates

## 19.1 Extension repository CI

A normal CI workflow should run:

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build

cargo fmt --manifest-path native-host/Cargo.toml --check
cargo clippy --manifest-path native-host/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path native-host/Cargo.toml
cargo build --manifest-path native-host/Cargo.toml --release
```

Also run Playwright mock-transport E2E.

Use Windows CI for:

- release native-host build;
- PowerShell installer/registry unit tests;
- optional real Chrome integration if stable enough.

Upload build artifacts when useful:

- unpacked extension ZIP/directory artifact;
- `copyit-native-host.exe`;
- integration failure logs/screenshots that contain no prompt secrets.

## 19.2 Desktop repo gates

At minimum run the existing repository gates:

```text
cargo fmt --check
cargo check
cargo clippy --all-targets -- -D warnings
cargo test
cargo test --bin copyit sim_journeys -- --test-threads 1
cargo build --release
```

If the repo's current CI contains additional commands, run them too.

## 19.3 No-warning rule

Do not leave Clippy/TypeScript/ESLint warnings because “it still builds.” Treat warning-free CI as part of done.

---

# 20. Documentation deliverables

## 20.1 Root README

Replace the placeholder README with a useful overview containing:

- what the extension does;
- relation to desktop CopyIt;
- architecture diagram;
- prerequisites;
- build commands;
- personal/unpacked install steps;
- how SQLite migration works at a high level;
- where data lives;
- how protected prompts behave;
- how to uninstall without deleting user data;
- links to detailed docs.

## 20.2 `docs/architecture.md`

Explain:

```text
Desktop CopyIt ───────┐
                      ├── %APPDATA%\CopyIt\copyit.db
Native Host ──────────┘
      ▲
      │ Chromium Native Messaging
      ▼
Browser Extension Popup
      │
      └── Clipboard
```

Include process/security boundaries and why no browser-owned prompt DB exists.

## 20.3 `docs/protocol.md`

Document every method, request/response shape, error code, size limit, versioning rule, and vault lifecycle.

## 20.4 `docs/storage-migration.md`

Document JSON→SQLite algorithm, backup naming, recovery, downgrade caveat, and how to inspect/restore backups.

## 20.5 `docs/installation.md`

Exact Chrome and Edge developer-mode instructions plus PowerShell scripts.

## 20.6 `docs/troubleshooting.md`

Cover:

- native host not found;
- extension ID mismatch;
- registry manifest path stale;
- DB locked/busy;
- migration failure;
- vault password rejected;
- browser copy permission failure;
- how to run self-test/verify script.

## 20.7 `docs/security.md`

Explain minimal permissions, local-only data path, no telemetry, host origin restriction, and vault key lifetime.

---

# 21. Implementation sequence — execute continuously

The agent should perform these phases in order and should not ask for confirmation between normal phases.

## Phase A — establish baselines

1. Pull latest `main` in both repos.
2. Record start SHAs.
3. Run baseline tests in desktop CopyIt before modifying it.
4. Inspect existing desktop `storage.rs`, `store.rs`, `model.rs`, `vault.rs`, editor/app persistence call sites, and simulation fixtures.
5. Confirm extension repo is still only plan/docs or account for any newer implementation before overwriting anything.
6. Create coordinated feature branches.

**Gate:** baseline failures must be recorded and distinguished from regressions.

## Phase B — define shared contracts first

1. Write protocol types/docs.
2. Define schema v1 SQL.
3. Define legacy mapping.
4. Create synthetic vault compatibility vectors.
5. Create error-code enum.
6. Create deterministic extension-ID script/design.

**Gate:** both Rust and TypeScript representations have tests for representative protocol examples.

## Phase C — implement native-host storage/migration

1. Rust crate scaffold.
2. data-dir resolution;
3. SQLite schema/migrations;
4. migration lock;
5. legacy JSON import;
6. verification/backups;
7. query repository;
8. vault compatibility;
9. protocol framing;
10. methods;
11. origin validation;
12. self-test diagnostics;
13. unit + subprocess integration tests.

**Gate:** host can migrate a fixture, list metadata, retrieve plaintext, unlock/decrypt protected prompt, and exit cleanly using real framing.

## Phase D — migrate desktop CopyIt

1. Add SQLite dependency.
2. Add description model/editor support.
3. Refactor store/persistence to SQLite.
4. Reuse/port migration semantics.
5. Preserve vault behavior exactly.
6. Update search cache.
7. Update persistence call sites.
8. Update tests and sim fixtures.
9. Run full desktop test suite.

**Gate:** desktop passes all existing and new tests, opens migrated legacy fixture, edits it, reorders, restarts, and sees exact persisted state.

## Phase E — implement extension UI

1. TypeScript/build scaffold.
2. Manifest V3.
3. deterministic manifest key/ID.
4. popup shell.
5. native client.
6. search/category list.
7. compact rows.
8. accessible tooltip.
9. pagination.
10. clipboard flow.
11. protected unlock flow.
12. error/empty states.
13. unit tests.
14. Playwright mock E2E.

**Gate:** all required popup journeys pass and no prompt body appears in list DOM/state fixtures.

## Phase F — installer/registration

1. build script;
2. install script;
3. host manifest generator;
4. Chrome registry registration;
5. Edge registry registration;
6. uninstall script;
7. verify script;
8. local real-browser integration test.

**Gate:** clean Windows user account can follow documented steps from clone → build → install host → load unpacked extension → copy a real prompt.

## Phase G — integration with real user data safeguards

Do **not** use the user's actual `%APPDATA%\CopyIt` library for destructive testing.

Use a copied fixture/temp data dir first.

After automated migration is proven on fixtures:

1. back up actual user JSON if performing a manual local certification;
2. launch updated desktop or host to perform migration;
3. verify visible prompt count/titles/order/categories;
4. verify a plaintext copy;
5. verify a protected prompt unlock/copy if a disposable/test protected prompt exists; do not expose secrets in logs/screenshots;
6. verify desktop and extension see an edit without synchronization code (because same DB);
7. verify simultaneous desktop-open + extension-read works.

If real-data certification is unsafe/unavailable in the agent environment, stop at fixture certification and clearly state that limitation. Do not fabricate results.

## Phase H — CI/docs/final hardening

1. add CI;
2. run format/lint/typecheck/tests/builds;
3. run Windows install verification where possible;
4. inspect built manifest permissions manually;
5. grep built output/logging code for accidental body/password logging;
6. inspect git diff for secrets/private extension keys;
7. complete docs;
8. fix all Critical/High regressions and all deterministic test failures.

## Phase I — commit and push

Use coherent commits, for example:

### Extension repo

```text
feat(storage): add sqlite native host and safe legacy migration
feat(extension): add compact manifest-v3 prompt picker
feat(vault): support session-scoped protected prompt unlock
feat(install): add chrome and edge native-host registration
ci(test): add protocol ui and windows integration gates
docs: document architecture migration installation and recovery
```

### Desktop repo

```text
feat(storage): migrate CopyIt persistence from json to sqlite
feat(snippets): add optional prompt descriptions
refactor(store): persist row mutations and ordering transactionally
test(storage): cover migration concurrency and browser compatibility
docs: document sqlite storage and browser extension compatibility
```

Push both feature branches.

If the execution environment is authorized to open PRs, create coordinated PRs with cross-links. Do not auto-merge unless explicitly asked.

---

# 22. Detailed acceptance criteria

The project is **not done** until all applicable criteria below are satisfied.

## Storage and migration

- [ ] canonical data is `%APPDATA%\CopyIt\copyit.db`;
- [ ] no live dual-write JSON synchronization exists;
- [ ] valid legacy JSON imports automatically;
- [ ] legacy IDs preserved;
- [ ] snippet order preserved;
- [ ] categories/theme preserved;
- [ ] vault salt/canary preserved;
- [ ] protection hint/nonce/ciphertext preserved byte-for-byte as encoded text;
- [ ] corrupt non-empty legacy file is never treated as missing;
- [ ] failed migration never deletes/overwrites the only source data;
- [ ] successful migration creates recoverable legacy backups;
- [ ] migration is idempotent;
- [ ] concurrent first-launch migration is locked/coordinated;
- [ ] SQLite integrity/schema checks pass;
- [ ] WAL permits desktop writes while native host reads.

## Desktop

- [ ] desktop app boots from SQLite;
- [ ] add/edit/delete persists;
- [ ] reorder persists;
- [ ] description can be edited;
- [ ] description participates in search;
- [ ] protected snippet behavior is unchanged;
- [ ] current unit tests pass;
- [ ] current simulation journeys pass;
- [ ] Clippy warning-free;
- [ ] release build succeeds.

## Native host

- [ ] stable host name;
- [ ] correct binary framing;
- [ ] stdout contains protocol bytes only;
- [ ] origin validated;
- [ ] unknown protocol/method rejected safely;
- [ ] response sizes bounded;
- [ ] list results contain metadata only;
- [ ] SQL uses bound parameters;
- [ ] protected body is unavailable while locked;
- [ ] correct vault password decrypts compatible existing ciphertext;
- [ ] wrong password/tamper fails safely;
- [ ] key is session/process scoped and zeroized/dropped on close;
- [ ] no V1 mutation API exposed;
- [ ] subprocess framing integration passes.

## Browser extension

- [ ] Manifest V3;
- [ ] Chrome works;
- [ ] Edge works;
- [ ] toolbar action opens popup;
- [ ] UI is compact title + copy control per row;
- [ ] descriptions are tooltip-only;
- [ ] tooltip works on hover and keyboard focus;
- [ ] no tooltip for empty description;
- [ ] search works;
- [ ] category filter works;
- [ ] pagination works;
- [ ] copy writes exact full body;
- [ ] copy success feedback works;
- [ ] protected copy triggers unlock and retries;
- [ ] host-not-installed state is understandable;
- [ ] no prompt bodies persisted in browser storage;
- [ ] no broad host/site permissions;
- [ ] long titles/tooltip text remain usable;
- [ ] unit + Playwright E2E pass.

## Installation

- [ ] deterministic extension ID established;
- [ ] private extension key is not committed;
- [ ] host manifest contains only expected allowed origin(s);
- [ ] Chrome HKCU registration works;
- [ ] Edge HKCU registration works;
- [ ] install requires no admin rights;
- [ ] verify script detects broken registration;
- [ ] uninstall leaves user database/backups intact.

## Security/privacy

- [ ] no telemetry;
- [ ] no network dependency for normal operation;
- [ ] no body/password/key logging;
- [ ] no remote scripts;
- [ ] CSP is compatible with MV3 defaults/restrictions;
- [ ] protocol cannot select arbitrary local files;
- [ ] built permission set is minimal and documented.

---

# 23. Explicit non-goals for this implementation

Do not expand V1 into any of the following unless required to fix a correctness issue:

- browser-side prompt editing;
- browser-side prompt creation/deletion;
- direct injection into ChatGPT/Claude/Gemini textareas;
- cloud sync;
- accounts/authentication;
- Chrome Web Store publication;
- Edge Add-ons publication;
- mobile support;
- telemetry/analytics;
- remote backend/API;
- always-running Windows service;
- WebSocket/localhost HTTP server;
- FTS search unless ordinary SQL is proven inadequate;
- wholesale redesign of desktop CopyIt UI;
- changing vault cryptography.

Keep the implementation focused on eliminating window switching and prompt-copy friction.

---

# 24. Agent decision policy

The implementation agent should use this hierarchy when it encounters an unmentioned detail:

1. **Data safety** over convenience.
2. **Compatibility with existing CopyIt behavior** over architectural novelty.
3. **Minimal browser permissions** over feature breadth.
4. **Single canonical SQLite source** over synchronization mechanisms.
5. **Small/testable modules** over large convenience files.
6. **Simple local implementation** over cloud/services/frameworks.
7. **Deterministic tests** over manual-only confidence.
8. **Finish the complete vertical slice** over polishing optional extras.

Routine implementation choices should be made autonomously. Do not pause to ask the user whether to name a helper differently, choose one equivalent testing library over another, or make other reversible low-risk decisions.

If a core assumption is impossible, document the evidence, choose the closest architecture that preserves the goals, and continue as far as safely possible rather than stopping the entire campaign.

---

# 25. Final certification report required from the executing agent

At the end of the one-shot implementation, produce a concise but complete report containing:

## Repositories / branches / SHAs

```text
CopyIt-brwsr-ext
  branch:
  start SHA:
  final SHA:

CopyIt
  branch:
  start SHA:
  final SHA:
```

## Implemented

Summarize:

- SQLite migration;
- desktop persistence refactor;
- description support;
- native host/protocol;
- vault compatibility;
- extension UI/tooltip/search/copy;
- Chrome/Edge registration;
- CI/tests/docs.

## Validation matrix

List each command actually run and PASS/FAIL, not just “tests passed.”

Include:

- Rust fmt/clippy/test/build for both repos;
- desktop simulation journeys;
- npm format/lint/typecheck/unit/build;
- Playwright E2E;
- native subprocess integration;
- Windows native registration/integration if environment allowed it;
- fixture migration validation.

## Data-safety evidence

State:

- migration fixture counts/hashes/order result;
- protected compatibility result;
- backup behavior result;
- corrupt-file behavior result;
- concurrent DB access result.

## Known limitations

Only list real residual limitations. Do not disguise failed gates as “future improvements.”

## Installation

Give the exact final commands the user should run to install/update the personal extension.

---

# 26. Definition of success

The finished workflow should be this simple:

```text
Chrome / Edge
    ↓
click pinned CopyIt icon
    ↓
search or scan compact titles
    ↓
(optional) hover → description tooltip
    ↓
click Copy
    ↓
full prompt is now on clipboard
```

And the underlying architecture should remain:

```text
                         ┌──────────────────────┐
                         │ %APPDATA%\CopyIt     │
                         │     copyit.db        │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
          CopyIt desktop app                Rust native host
           edit/write/read                    read/decrypt
                                                    │
                                                    │ Native Messaging
                                                    ▼
                                           MV3 browser popup
                                                    │
                                                    ▼
                                                 Clipboard
```

There must be no second prompt library to synchronize, no background web service, no cloud requirement, and no need to keep the desktop CopyIt window open just to use prompts in the browser.
