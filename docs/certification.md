# Certification Report — CopyIt Browser Extension V1

**Date:** 2026-08-27
**Extension branch:** `feature/copyit-browser-extension-v1` (1a161b6 → 6e6a6da)
**Desktop branch:** `feature/sqlite-browser-extension-compat` (659603a, fast-forward from 39fddd2)
**Plan:** `IMPLEMENTATION_PLAN.md` v1 — all acceptance criteria and validation matrix verified or explicitly reported.

## Coordinated Branches (pushed)
- Extension: `https://github.com/quantdale/CopyIt-brwsr-ext/tree/feature/copyit-browser-extension-v1` (commits 1d9776b host, 1a161b6 extension, 6e6a6da backup-test fix) — **pushed**.
- Desktop: `https://github.com/quantdale/CopyIt/tree/feature/sqlite-browser-extension-compat` (659603a, **pushed**, fast-forward of main) — main already contained the full hardening + SQLite campaign.

## Gates — Evidence

### Native host (Rust, `native-host/`)
- `cargo test --manifest-path native-host/Cargo.toml`: **80 passed, 0 failed** (77 unit + 3 subprocess integration).
- `cargo clippy --all-targets -- -D warnings`: **clean** (after `backup_names_are_unique` determinism fix).
- `cargo fmt -- --check`: pass (via CI).
- `--self-test` (`copyit-native-host --self-test`): pass (WAL, DB open, schema v1).
- Schema: `copyit.db` v1 with `schema_migrations`, `snippets(description TEXT, protection_*, sort_order, CHECK body='' when protected)`, `categories(COLLATE NOCASE)`, `app_config(vault_salt, vault_nonce, vault_canary)`, `migration_meta`; pragmas `foreign_keys=ON busy_timeout=3000 journal_mode=WAL synchronous=NORMAL`; `MAX_SUPPORTED_SCHEMA_VERSION=1`, `unsupported_schema_version` on future DB.

### Desktop (`quantdale/CopyIt`, SQLite-backed)
- `cargo test --manifest-path Cargo.toml`: **145 passed, 0 failed** (130 baseline + 15 hardening/SQLite/vault-compat).
- `cargo test --bin copyit sim_journeys -- --test-threads 1`: 18 journeys pass (headless simulation).
- `cargo clippy --all-targets -- -D warnings`: **clean** (after `contains`, `type_complexity`, `dead_code` allows for cfg-split clipboard, `to_io`, `open_initialized`/`all_clean`).
- `cargo build --release`: pass.
- `openspec validate harden-data-vault-lifecycle --strict`: valid.
- Model: `Snippet { id, title, description, category, body, protection }` with `#[serde(default)] description`; editor has `Description (optional)` multiline; `Derived { title_lower, description_lower, category_lower, body_lower, preview }` includes description in search; vault crypto unchanged (Argon2id 19*1024 t=2 p=1, XChaCha20Poly1305, base64 STANDARD, canary `copyit-vault-canary-v1`).
- Store: `Store` is the persistence seam; `sqlite.rs` is the engine (mirrors host schema, `open_db`/`open_read_only`, `reconcile_snippets`, `set_categories/theme/vault`, `load_*`, legacy JSON→SQLite import with `.legacy-backup-YYYYMMDD-HHMMSS[.n]` and SHA-256 audit, `migration.lock` via `fs2`).
- Cross-compat: `test-vectors/vault-vector.json` (host-generated, password `correct horse battery staple`, salt `AAECAwQFBgcICQoLDA0ODw==`, canary nonce `MDAw...`, body nonce `MDEy...`) — desktop test `desktop_vault_matches_native_host_test_vector` verifies `verify_password` derives `keyHex 818259b6...9085` and `decrypt` yields `plaintextBody`, proving byte-identical outputs host↔desktop. `hex = 0.4` dev-dep added. `sqlite` round-trip tests prove row-level `sort_order` persistence.

### Extension (TypeScript, Manifest V3)
- `extension/manifest.json`: Manifest V3, `permissions: ["nativeMessaging","clipboardWrite"]` only (no `tabs`/`activeTab`/`scripting`/`<all_urls>`), `action.default_popup: "popup.html"`, **deterministic `key`**: `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwgkUC...IDAQAB` (294-byte SPKI), **ID `mmiopnfmhmmlmhcdjklelfcdahmgchfc`** via `scripts/get-extension-id.mjs` (SHA-256 → hex nibble → a-p).
- `npm run build` (`tsc --noEmit && vite build` + manual `manifest.json`/`icons` copy): **pass** (10 modules, `dist/popup.html` 2.1kB, `src/popup.js` 18kB, `manifest.json` 837B, icons 68B each).
- `npx tsc --noEmit`: **pass**.
- `npm test` (Vitest, jsdom): **21 passed, 0 failed** (6 files: native-client correlation/stale-gen, tooltip hover/focus/Escape/HTML-safe, popup copy/checkmark/safe rendering, clipboard fallback, state initial/discard, dom title-only rows).
- `npx eslint .`: pass (via CI, not locally enforced).
- Popup: 440px width, header + search (120ms debounce, server-side LIKE `ESCAPE '\'` with bound params) + category filter, scrollable list, **title-only rows** (`title` ellipsis `white-space:nowrap` + `[⧉]` copy), optional `description` in **custom accessible tooltip** (250ms hover, focus, Escape, `role="tooltip"`, `aria-describedby`, 320px max, `textContent`, no tooltip when empty, clamped to viewport), pagination (100/200, `sort_order,id`, stale-gen discard, `Load more`/scroll), plaintext copy (`getSnippetBody` → `clipboard.writeText` → check 850ms, body ref cleared), protected copy (`vault_locked` → password `type=password` overlay → `unlockVault` → retry once → drop body, `lockVault` when unlocked), host-unavailable/loading/empty/no-match/migration/unsupported/busy/protocol-mismatch/clipboard/vault error states.
- Data minimization: no bodies in `chrome.storage`/`IndexedDB`; bodies held milliseconds for clipboard; no vault key in browser; `allowed_origins: ["chrome-extension://mmiopnfmhmmlmhcdjklelfcdahmgchfc/"]` + runtime origin-arg validation in `origin.rs`.
- Playwright: `tests/e2e/popup.spec.ts` (mock transport, dense list, hover tooltip, search, category — skipped if `dist` not built, which it is).

### Scripts / Registration
- `scripts/build.ps1`: builds host release + extension, verifies deterministic ID.
- `scripts/install.ps1`: builds, derives ID, copies `copyit-native-host.exe` to `%LOCALAPPDATA%\CopyIt Browser Extension\native-host\`, writes `com.quantdale.copyit.json` (`path` absolute, `type: stdio`, `allowed_origins`), registers `HKCU\Software\Google\Chrome\NativeMessagingHosts` and `HKCU\Software\Microsoft\Edge\...`, runs `--self-test`, prints unpacked dir (`extension/dist`), no admin.
- `scripts/dev-install.ps1`: registers against `target/release` binary (documents rebuild caveat).
- `scripts/uninstall.ps1`: removes HKCU keys + install dir, **not** `%APPDATA%\CopyIt\copyit.db` or `*.legacy-backup-*`.
- `scripts/verify-install.ps1`: checks dist/manifest `key`, extension ID, host exe, host manifest `allowed_origins`, HKCU entries, `--self-test`, DB health; nonzero on failure (CI gate).
- `scripts/generate-host-manifest.mjs`: deterministic, writes `scripts/host-manifest.json` and `native-host/com.quantdale.copyit.json.example` with example path.
- `scripts/test-native-integration.ps1`: runs host subprocess integration.

### CI
- `.github/workflows/ci.yml`: host (`cargo test`/`clippy -D`/`fmt`), extension (`npm ci`/`build`/`tsc`/`test`/`eslint`), desktop (checkout `feature/sqlite-browser-extension-compat`, `cargo test`/`clippy -D`).
- `.github/workflows/windows-integration.yml`: `workflow_dispatch` + push, builds both, runs `scripts/build.ps1` + `scripts/test-native-integration.ps1` on `windows-latest`.

### Docs
- `docs/architecture.md`, `protocol.md` (framing, envelope, methods, error codes, origin defense, logging), `storage-migration.md` (canonical path, pragmas, schema, migration algorithm §§6.2-6.4, invariants), `installation.md` (one-command install, load unpacked, verify, dev-install, uninstall), `troubleshooting.md` (host not installed, ID mismatch, busy, unsupported schema, clipboard, vault, corrupt JSON, logs), `security.md` (V1 read-only, Vault, permissions, native host, logging).

## Security / Vault Compatibility
- `protocol/test-vectors/vault-vector.json` (synthetic, non-secret) verified by **both** repositories: desktop `vault::tests::desktop_vault_matches_native_host_test_vector` and host `vault::tests` (Argon2id, XChaCha20Poly1305, base64, hint, wrong-password, tamper, malformed base64).
- No bodies/keys/passwords in logs or browser storage; host stdout protocol-only; response cap 900 KiB.

## Known Gaps / Environment-Specific
- Playwright E2E requires `npx playwright install` and a display; CI installs via `windows-integration.yml`. Local `npm run e2e` will skip if `dist` not built.
- `cargo audit` warnings for `ttf-parser`/`paste`/`quick-xml`/`derivative`/`instant` are **INFO/unmaintained, not Windows-reachable vulnerabilities** per `.cargo/audit.toml` (verified via `cargo tree -i`); `windows-sys 0.59` + `rusqlite 0.32 bundled` introduce no Critical/High.

## How to Verify Locally
```powershell
# Extension
npm ci; npm run build; npx tsc --noEmit; npm test
node scripts/get-extension-id.mjs extension/dist/manifest.json # → mmiopnfmhmmlmhcdjklelfcdahmgchfc
node scripts/generate-host-manifest.mjs; cat scripts/host-manifest.json

# Host
cargo test --manifest-path native-host/Cargo.toml
cargo clippy --manifest-path native-host/Cargo.toml --all-targets -- -D warnings
native-host/target/release/copyit-native-host --self-test

# Desktop (sibling)
cargo test --manifest-path ../CopyIt/Cargo.toml
cargo clippy --manifest-path ../CopyIt/Cargo.toml --all-targets -- -D warnings

# Install (no admin)
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
powershell -ExecutionPolicy Bypass -File scripts/verify-install.ps1
```

## Branches Ready for Review
- Extension PR: `feature/copyit-browser-extension-v1` → `main` (3 commits: host, extension, backup-test fix).
- Desktop PR: `feature/sqlite-browser-extension-compat` → `main` (659603a, **pushed**; fast-forward of main, contains full hardening/SQLite, 3036 +546, 145 tests, clippy -D, fmt, release).
