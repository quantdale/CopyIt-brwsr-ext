# Repository Guidelines

## Project Overview

CopyIt browser extension: a Chrome/Edge Manifest V3 popup that searches and copies prompts from the **desktop CopyIt app's own SQLite library**. This repo owns the extension, the Rust native-messaging host, the wire protocol, Windows install tooling, tests, CI, and certification evidence.

V1 surface is **read/search/filter/copy/unlock/lock only**. No writes, no website injection, no second prompt store.

The desktop app lives in the sibling repo `quantdale/CopyIt` and is the *only* writer of the canonical database. Keep the repos separate — never nest one inside the other.

## Architecture & Data Flow

```
%APPDATA%\CopyIt\copyit.db   (canonical SQLite, WAL)
        |                              |
   desktop CopyIt (writer)      native host (reader)
                                       |  stdin/stdout, 32-bit native-endian
                                       |  length-prefixed UTF-8 JSON
                                 chrome.runtime.connectNative
                                       |
                             MV3 popup (extension/dist)
                                       |
                              navigator.clipboard
```

Three hard boundaries:

1. **Popup ↔ host** — `chrome.runtime.connectNative` **long-lived port**, not per-request spawning. `NativeClient` (`extension/src/native-client.ts`) owns the port, a `Map<string, Pending>` keyed by `requestId`, a 3500 ms default timeout plus a 10,000 ms `unlockVault` timeout, and reconnects lazily on the next request after a disconnect.
2. **Host ↔ SQLite** — read-only query repository in `native-host/src/db.rs`. V1 exposes **no write methods over the protocol**.
3. **Host ↔ vault** — Argon2id + XChaCha20-Poly1305 in `native-host/src/vault.rs`. The derived key lives only in host memory; it never reaches the browser.

Flows (all correlate by `requestId`):

- **List / search / filter** — `loadSnippets()` bumps a module-level `generation` counter, awaits `listSnippets`, then discards the response if `gen !== generation`. Search input debounces `SEARCH_DEBOUNCE_MS = 120`. `PAGE_SIZE = 100`; `loadMore()` appends. Search covers title, description, category, and unprotected plaintext bodies; protected bodies are not searchable.
- **Plaintext copy** — `handleCopy(id, btn)` → `getSnippetBody` → `writeText(body)` → `showCopySuccess`. The local `body` is reassigned to `""` immediately after the clipboard write.
- **Protected copy while locked** — `getSnippetBody` fails `vault_locked` → `showOverlay(...)`; the `PendingCopy { id, button, originalText }` record is retained. **Retry targeting uses that captured button reference, never a lookup by user-visible label text.**
- **Unlock** — `unlockVault` uses its 10,000 ms budget; clear `els.vaultPassword.value` → `state.vaultState = "unlocked"` → retry the captured pending copy **exactly once**. A timeout asks `hello` for the authoritative vault state before the popup reports failure.
- **Relock** — `lockVault`; on failure the UI keeps its previous state and calls `setStatus(..., true)`. A failed lock must never render as locked.

## Key Directories

| Path | Purpose |
| --- | --- |
| `extension/src/` | Popup TypeScript + `popup.css`. Modules: `popup.ts` (orchestration), `native-client.ts` (transport), `protocol.ts` (wire types), `state.ts` (`AppState`), `dom.ts` (element helpers), `clipboard.ts`, `copy-feedback.ts`, `tooltip.ts` |
| `extension/tests/` | Vitest unit tests (jsdom) |
| `extension/dist/` | Build output; the artifact you load unpacked. Git-ignored |
| `native-host/src/` | Rust host: `main.rs` CLI + handlers, `framing.rs`, `protocol.rs`, `origin.rs`, `db.rs`, `vault.rs`, `migration.rs`, `legacy.rs`, `logging.rs`, `lib.rs` |
| `native-host/src/bin/` | `cert_fixture.rs` — builds deterministic synthetic test databases |
| `native-host/tests/` | `subprocess.rs` — spawns the real host binary over real framing |
| `protocol/` | `README.md` (v1 contract) and `test-vectors/vault-vector.json` (cross-repo crypto vector) |
| `tests/` | Playwright mock E2E (`tests/e2e/`), real-browser certification `.mjs` scripts, `tests/helpers/` |
| `scripts/` | Windows install/verify/uninstall PowerShell, ID/manifest generators, MCP validators |
| `docs/` | Architecture, installation, security, storage-migration, troubleshooting, certification ledger |

## Development Commands

```bash
npm ci                       # deterministic install; never plain `npm install`
npm run build                # icon validation + tsc --noEmit + vite build + copy manifest/icons -> extension/dist
npm run dev                  # vite build --watch
npx tsc --noEmit             # typecheck only
npm run lint                 # eslint .
npm test                     # vitest run --reporter=verbose
npm run e2e                  # playwright test (requires npm run build first)
npm run extension:id         # derive the deterministic extension ID
```

Rust host:

```bash
cargo fmt   --manifest-path native-host/Cargo.toml -- --check
cargo clippy --manifest-path native-host/Cargo.toml --all-targets --all-features -- -D warnings
cargo test  --manifest-path native-host/Cargo.toml --all-targets --all-features
cargo build --release --manifest-path native-host/Cargo.toml
cd native-host && cargo audit     # cargo-audit 0.22.x rejects --manifest-path
```

Install lifecycle (Windows, HKCU, no admin):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
powershell -ExecutionPolicy Bypass -File scripts/verify-install.ps1   # -Browser Chrome|Edge|Both
powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1
```

Certification (needs an installed + registered host):

```bash
npm run cert:native          # subprocess protocol suite against the installed host
npm run cert:failure         # wrong origin, unsupported schema, oversized frame
npm run cert:chrome-install  # executable + manifest key + deterministic ID + exact origin
npm run cert:chromium        # bundled Chromium — label Chromium, never "Chrome"
npm run cert:edge            # real Edge Stable
npm run cert:chrome          # real Chrome Stable; exit 2 == NOT-RUN / ENVIRONMENT-BLOCKED
npm run benchmark:performance
npm run mcp:preflight && npm run mcp:validate
```

## Code Conventions & Common Patterns

**TypeScript**

- ESM with explicit `.js` specifiers in relative imports (`from "./native-client.js"`) even though sources are `.ts`.
- `strict: true`, `noEmit: true`. Prefer `unknown` + a narrowing cast at the boundary over `any`; failure envelopes are narrowed via the `isFailure()` type guard.
- Naming: `camelCase` functions/vars, `PascalCase` types/classes, `SCREAMING_SNAKE` module consts (`PAGE_SIZE`, `HOST_NAME`, `DEFAULT_TIMEOUT_MS`).
- **State**: one module-level `const state: AppState = initialState()` in `popup.ts`. No framework, no store library. Cached DOM handles live in a single `els` object assigned during `init()`.
- **DOM**: build nodes with `el()` / `createSnippetRow()` from `dom.ts`; clear with `clearChildren()`. Never `innerHTML` with data. Toggle visibility with `setHidden()`, which also maintains `aria-hidden`. IDs are kebab-case (`category-filter`, `vault-password`); classes are kebab-case (`snippet-row`, `copy-btn`, `badge-protected`).
- **Async**: `async/await` with `try/catch`. Errors surface as `Error & { code?: string }`, and UI branches on the stable protocol `code`, not on message text.
- **Staleness**: any request that can be superseded must capture `const gen = ++generation` and bail on `gen !== generation` in **both** the success and the catch path.
- **Injection seam**: `NativeClient` takes an optional `Transport { connect, isAvailable }`. That is the dependency-injection point tests use — do not stub `chrome.*` globals instead.
- **Lifecycle**: every request settles and clears its timer; disconnect rejects pending work once; late responses and stale-port events are ignored; `pagehide` tears down popup timers, tooltip state, and the native port.

**Rust**

- One responsibility per module: framing (`framing.rs`), envelope/validation (`protocol.rs`), origin defense (`origin.rs`), storage (`db.rs`), crypto (`vault.rs`), migration/paths (`migration.rs`), legacy JSON parsing (`legacy.rs`), logging (`logging.rs`). `main.rs` is a thin CLI over `lib.rs`.
- Typed errors via `thiserror` (`FrameError`, `DbError`, `MigrationError`), each mapped to a stable `ErrorCode` at the protocol edge. Never leak a `Display` of an internal error to the browser.
- `//!` module docs state the invariant the module enforces; keep that habit.
- Unit tests are in-file `#[cfg(test)] mod tests`; only cross-process tests live in `native-host/tests/subprocess.rs`.
- SQL is always bound parameters plus `ESCAPE '\'` with `escape_like()`; pagination is capped by `PAGE_LIMIT_CAP = 200`.

**Non-negotiable invariants** (enforced in code — do not weaken to make a test pass):

- One canonical library: `%APPDATA%\CopyIt\copyit.db`. No live JSON/SQLite dual-write.
- Host **stdout is protocol-only**; human-readable output belongs to explicit CLI switches (`--self-test`, `--version`, `--print-data-dir`, `--check-db`, `--migrate-only`) and diagnostics go to stderr/log.
- `allowed_origins` holds **exactly one** exact origin, never `*`; the host also validates the launch origin argv at runtime.
- Permissions stay `["nativeMessaging", "clipboardWrite"]`. No `tabs`, `activeTab`, `scripting`, or host permissions.
- List results never carry bodies or ciphertext; protected bodies are not searchable.
- Active native logs are capped at 256 KiB. Startup rotation replaces one
  `native-host.log.old` backup, and a failed replacement truncates the active
  file rather than allowing unbounded growth.
- The popup vault password input uses `autocomplete="off"` and clears on
  success, cancellation, and overlay dismissal.
- No prompt bodies, passwords, derived keys, or protected plaintext in browser storage, logs, CI artifacts, or protocol diagnostics.
- A database newer than `MAX_SUPPORTED_SCHEMA_VERSION` is refused, never guessed at.
- Description is optional and tooltip-only in the compact list.
- `scripts/uninstall.ps1` removes only HKCU registrations and `%LOCALAPPDATA%\CopyIt Browser Extension\`. It must never delete `copyit.db`, WAL/SHM sidecars, or `*.legacy-backup-*`.

**Adding a protocol method** requires all of these together, or the change is incoherent:
`extension/src/protocol.ts` (`Method` union, result interface) → `extension/src/native-client.ts` caller → `native-host/src/protocol.rs` (`method::` const + `method::ALL`) → `native-host/src/main.rs` dispatch → `native-host/src/db.rs` if it touches storage → `protocol/README.md` → a `native-host/tests/subprocess.rs` case.

## Important Files

- `extension/manifest.json` — MV3 manifest. The committed `key` fixes the deterministic ID `mmiopnfmhmmlmhcdjklelfcdahmgchfc`; changing it breaks every origin binding and registration.
- `extension/popup.html` — Vite entry; `extension/src/popup.ts` is the runtime entry (`DOMContentLoaded` → `init()`).
- `native-host/src/main.rs` — host entry, argv/origin gate, request dispatch.
- `protocol/README.md` — authoritative v1 wire contract (envelope, methods, error codes, `retryable`, 900 KiB response cap).
- `protocol/test-vectors/vault-vector.json` — cross-repo crypto vector both repos assert against.
- `vite.config.mts` — `root: extension`, `outDir: dist`, entry `extension/popup.html`, `minify: false`, `publicDir: false`. Manifest and icons are copied by the `build` script's trailing node step, **not** by Vite — so `vite build` alone does not produce a loadable extension.
- `scripts/validate-icons.mjs` — validates the three release PNG signatures, exact dimensions, and 8-bit RGBA encoding; `npm run build` runs it before bundling.
- `vitest.config.mts` — jsdom, `include: ["extension/tests/**/*.{test,spec}.{ts,js}"]`, v8 coverage.
- `playwright.config.ts` — `testDir: "tests/e2e"`, chromium project only.
- `.mcp.json` — repo-local MCP servers, pinned: `chrome-devtools-mcp@1.8.0` (headless), `context7@4.0.3`.
- `scripts/verify-install.ps1` — strict gate: manifest `key` present and base64, derived ID is 32 chars and equals the committed ID, release exe exists, host manifest `name`/`type`/absolute existing `path`, **exactly one** matching `allowed_origins`, HKCU keys point at that manifest, and `--self-test` passes for both the installed and built binaries.
- `docs/certification.md` — current release decision and evidence matrix.
- `docs/implementation/EVIDENCE_LEDGER_2026-08-28.md` — command-by-command evidence; the `## Current release rerun` section supersedes the historical snapshot below it.
- `IMPLEMENTATION_PLAN.md`, `docs/agent-integrations/*` — **historical** design/handoff context. Do not treat their unchecked boxes as missing features.

## Runtime/Tooling Preferences

- **Node 24.3.0**, pinned by `.node-version` (no `engines` field). **npm + `package-lock.json`; use `npm ci`.** Not Bun.
- **Rust 1.93.1**, pinned by `rust-toolchain.toml` (profile `minimal`, components `clippy`, `rustfmt`). CI passes `toolchain: 1.93.1` and `components: rustfmt, clippy` explicitly to the SHA-pinned `dtolnay/rust-toolchain` action.
- **Windows-first**: the host, install tooling, registry integration, and all certification are Windows-only. All three workflows run on `windows-latest`.
- Vite 8.2.2 / Vitest 4.1.11 are exact-pinned; GitHub Actions are pinned to immutable commit SHAs. Preserve both when editing dependencies.
- Rust deps that carry contract meaning: `rusqlite` (bundled SQLite), `argon2`, `chacha20poly1305`, `zeroize`, `fs2` (cross-process `migration.lock`), `sha2`, `thiserror`.
- `cert_fixture` is auto-discovered from `native-host/src/bin/`; it is not declared as a `[[bin]]`.

## Testing & QA

| Tier | Location | Invocation | Proves |
| --- | --- | --- | --- |
| Unit (TS) | `extension/tests/*.test.ts` (6 files, 23 tests) | `npm test` | Module logic in jsdom via injected `Transport` |
| Mock E2E | `tests/e2e/popup.spec.ts` (12 tests) | `npm run e2e` | The built popup bundle: races, retry, lock failure, a11y |
| Unit (Rust) | in-file `#[cfg(test)] mod tests` (79 tests) | `cargo test` | Framing, protocol, db, vault, migration, legacy, origin |
| Subprocess | `native-host/tests/subprocess.rs` (4 tests) | `cargo test` | Real binary over real framing, incl. empty-library clear-all |
| Failure states | `tests/test-failure-states.mjs` (5) | `npm run cert:failure` | Wrong origin, unsupported schema + clean EOF, oversized frame |
| Real browser | `tests/real-edge-e2e.mjs`, `chromium-functional-e2e.mjs`, `real-chrome-e2e.mjs` (36 checks each) | `npm run cert:edge` / `cert:chromium` / `cert:chrome` | Full journey against production `extension/dist` + real host |
| Performance | `tests/performance-benchmark.mjs` | `npm run benchmark:performance` | Popup shell, first-100 metadata, 10k title search |

Conventions and rules:

- Vitest style is `describe` / `it` with `expect`; fake timers for feedback-reset assertions.
- **Test the production module, never a replica.** `extension/tests/popup.test.ts` imports `showCopySuccess` and `truncateUtf8` from `extension/src/` rather than reimplementing them. A test that copies popup logic into the test file is a false green and will be rejected.
- Stub the `Transport` seam (`{ connect, isAvailable }`) and hand-rolled `chrome.runtime.Port` fakes; do not monkey-patch global `chrome`.
- All real-browser suites must build a fixture through `tests/helpers/cert-fixture.mjs`, which **throws** if the temp root resolves under `APPDATA` and delegates DB creation to the Rust `cert_fixture` binary for crypto byte-compatibility. Never point a destructive test at real user data.
- `npm run cert:native` additionally requires `scripts/install.ps1` to have run (it asserts HKCU registration and the installed host manifest). Running it uninstalled produces registry FAILs, not a meaningful result.
- Exit-code contract: `0` PASS, `1` FAIL, **`2` = `NOT-RUN / ENVIRONMENT-BLOCKED`**. `windows-certification.yml` converts only exit 2 from the Chrome step into a labelled non-blocking result; every other nonzero fails the job.
- Where to add a test: pure logic → `extension/tests/`; popup DOM/interaction → `tests/e2e/popup.spec.ts`; Rust logic → in-file `mod tests`; anything needing a spawned host → `native-host/tests/subprocess.rs`.

**Evidence vocabulary** — use these labels verbatim in reports and docs, and never upgrade one:

`VERIFIED-CODE` · `VERIFIED-CROSS-REPO` · `RUNTIME-VERIFIED` · `HISTORICAL-EVIDENCE` · `FAILED` · `NOT-RUN / ENVIRONMENT-BLOCKED`

A skip, absent browser, substitute browser, timeout, manually killed process, or unexecuted workflow is **never** a PASS. Bundled Chromium is Chromium evidence, never Chrome evidence; a "real Chrome" claim requires a real `chrome.exe` executing the journey. `BUILD SUCCESSFUL` is not verification.
