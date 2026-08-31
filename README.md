# CopyIt Browser Extension

Personal Chrome/Edge companion for [CopyIt](https://github.com/quantdale/CopyIt): a compact browser-toolbar prompt picker backed by the same local CopyIt library (search, copy, clipboard). It reads/searches/copies prompts and never injects into websites.

The current coordinated V1 implementation is developed on `main`. This README explains how to build, install, use, and uninstall it. Deep design, migration semantics, and truthful certification evidence live in the docs.

- `IMPLEMENTATION_PLAN.md` — approved architecture, SQLite migration, native-messaging protocol, popup UX, security, install tooling, tests, CI, and acceptance criteria.
- `docs/protocol.md` — wire protocol (framing, envelope, methods, error codes, origin defense, logging).
- `docs/storage-migration.md` — canonical database, schema, migration algorithm, invariants.
- `docs/installation.md`, `docs/troubleshooting.md`, `docs/security.md`, `docs/architecture.md`, `docs/certification.md`.

## Architecture

```text
                     %APPDATA%\CopyIt\copyit.db
                               |
                +--------------+---------------+
                |                              |
                v                              v
         CopyIt desktop                 Rust native host
          edit/write                     read/decrypt
                                               |
                                               | Chromium Native Messaging
                                               v
                                     Chrome / Edge MV3 popup
                                               |
                                               v
                                            Clipboard
```

Key decisions:
- one canonical SQLite library shared with desktop CopyIt;
- verified/recoverable migration from legacy JSON (sources preserved as backups);
- compact popup rows: title + copy control; descriptions are optional, tooltip-only;
- search + category filtering + pagination;
- protected snippets unlock for a session-scoped vault unlock;
- no browser-owned duplicate database, no cloud/backend/telemetry, no website injection;
- minimal permissions: `["nativeMessaging", "clipboardWrite"]` only;
- per-user (no admin) Chrome/Edge Native Messaging host with a deterministic extension ID.

## Requirements

- Windows 10/11 with Chrome or Edge (stable).
- Node.js 24.3.0 (the version in `.node-version`) and Rust 1.93.1 (the version in `rust-toolchain.toml`) to build from source.
- The desktop CopyIt app installed — it owns the `copyit.db` you search/copy.

## Build

```powershell
npm ci
npm run build
cargo build --release --manifest-path native-host/Cargo.toml
```

The extension (unpacked, MV3) is produced in `extension/dist/`; the native host in `native-host/target/release/copyit-native-host.exe`.

## Install the native host (no admin)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

`install.ps1` builds the release host and extension if needed, copies the host + manifest under `%LOCALAPPDATA%\CopyIt Browser Extension\native-host\`, derives the deterministic extension ID from the manifest `key`, writes `com.quantdale.copyit.json` with the absolute host path and exact `allowed_origins`, registers it under HKCU for both Chrome and Edge, runs `--self-test`, and prints the unpacked directory.

### Load the unpacked extension

- Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> select **`extension/dist`**.
- Edge: `edge://extensions` -> Developer mode -> Load unpacked -> select **`extension/dist`**.

The loaded ID must equal `node scripts/get-extension-id.mjs extension/dist/manifest.json`.
## Verify the installation

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify-install.ps1
```

Fails (nonzero exit) if the extension build, host binary, host-manifest `allowed_origins`, or host `--self-test` is invalid.

## Developer install (points at the target release binary)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-install.ps1
```

## Uninstall (user data survives)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

Removes the HKCU host registrations and the installed host under `%LOCALAPPDATA%\CopyIt Browser Extension\`. **Never deletes** `%APPDATA%\CopyIt\copyit.db` or any `*.legacy-backup-*` file.

## Where user data lives

- Canonical library: `%APPDATA%\CopyIt\copyit.db` (shared with the desktop app).
- Native host + manifest: `%LOCALAPPDATA%\CopyIt Browser Extension\native-host\`.
- Host logs (bounded, rotated, no plaintext/passwords/keys): `%LOCALAPPDATA%\CopyIt\logs\native-host.log`.
- Legacy backups after migration: `%APPDATA%\CopyIt\snippets.json.legacy-backup-*` and `config.json.legacy-backup-*`.

## Troubleshooting

See `docs/troubleshooting.md` (host not registered, extension-ID mismatch, database busy/migration, unsupported newer schema, clipboard blocked, vault locked / wrong password, corrupt legacy JSON).

## Development / validation

```powershell
npm test
npm run lint
npm run build
npx playwright install chromium
npm run e2e
npm run benchmark:performance
cargo test --manifest-path native-host/Cargo.toml
cargo clippy --manifest-path native-host/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path native-host/Cargo.toml -- --check
```

Cross-repo compatibility is pinned by the committed vault test vector `protocol/test-vectors/vault-vector.json`, which the desktop app also asserts against.

## Security

- Permissions are minimal: `["nativeMessaging", "clipboardWrite"]` (no `tabs`/`activeTab`/`scripting`/`<all_urls>`).
- The native host validates the exact launch origin at runtime and `allowed_origins` in the host manifest are exact-match only.
- Prompt bodies appear only transiently for clipboard copy; none are stored in browser storage; vault keys are never stored in the browser; host logs never contain plaintext/passwords/keys.

See `docs/security.md` for details.
