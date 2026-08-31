# CopyIt Browser Extension V1 — Certification Ledger

**Status:** POST-RELEASE HARDENING VERIFIED — the hardening implementation and all three required GitHub Actions workflows are green on `main`.

**Campaign:** `2026-08-31` post-release hardening rerun, executed on `main` after the V1 release certification.

**Repositories:** `quantdale/CopyIt-brwsr-ext` and sibling `quantdale/CopyIt`

The prior ledger conflated bundled Chromium with real Chrome functional
coverage. That record is superseded. This ledger separates Chrome install
identity, Chromium functional equivalence, Edge Stable functional E2E, Chrome
Stable automation, and Chrome Stable manual acceptance. No prompt body,
password, derived key, or ciphertext is recorded here.

## Post-release hardening rerun — 2026-08-31

This section is authoritative for the current hardening release. The
release-candidate snapshot below remains preserved as historical evidence.
The hardening implementation started from the certified `fdaeeb4` release and
is committed at `61db731523b9af56b84953d1ee31e38a97ebf6b8`. No prompt body,
password, derived key, or ciphertext is recorded here.

| Item | Current evidence |
| --- | --- |
| Extension branch | `main` |
| Hardening SHA | `61db731523b9af56b84953d1ee31e38a97ebf6b8` |
| GitHub Actions | CI `33392921147`; Windows Integration `33392921206`; Windows Certification `33392921184` — all `success` |
| TypeScript/Vitest | TypeScript PASS; Vitest 6 files, 32 tests |
| Popup production-path E2E | Playwright PASS; 24 tests against the built bundle |
| Native host tests | Cargo PASS; 85 unit tests and 6 subprocess tests |
| Native integration | PASS; wrapper and both Cargo suites |
| Failure-state certification | PASS; 5/5 |
| Unlock timing | Measured first attempts below 340 ms; correct unlock after six failures about 2.33 s; method-specific timeout is 10 s |
| Icons | Validator PASS; exact 16×16, 48×48, and 128×128 RGBA PNGs |
| Search semantics | Protected bodies remain unavailable to list/search; plaintext body search remains supported |
| Install lifecycle | PASS in disposable `APPDATA`/`LOCALAPPDATA`: install, strict verify, native/failure/browser gates, uninstall preservation, reinstall, strict verify |
| npm audit | PASS; zero vulnerabilities in both requested modes |
| Native cargo audit | PASS; no findings |
| Companion CopyIt | PASS; shared schema/vault gates and desktop tests/build remain green |

The browser boundary now rejects malformed response envelopes and protocol
version mismatches. Normal native requests retain a 3.5-second timeout;
`unlockVault` uses a 10-second timeout and reconciles with `hello` after a
timeout before changing browser vault state. The vault password field uses
`autocomplete="off"`; this discourages browser autofill but cannot override
password managers. No saved-credential profile was configured for this rerun,
so manager-specific suppression is not claimed.

The real Chrome command-line functional probe remains
`NOT-RUN / ENVIRONMENT-BLOCKED`; branded Chrome rejected Playwright extension
flags. The prior visible Chrome GUI acceptance is retained as
`HISTORICAL-EVIDENCE` and was not rerun during this hardening-only pass.
Bundled Chromium and Edge evidence remain separate from Chrome evidence.

## Release decision
All confirmed code-level hardening findings are resolved. Local build,
browser, native, security, performance, lifecycle, documentation, and
companion gates passed; the pushed hardening commit has green CI, Windows
Integration, and Windows Certification workflows. The current release
classification is:

```text
POST-RELEASE HARDENING COMPLETE
```

Chrome Stable automated functional coverage remains explicitly:

```text
Chrome Stable automated functional gate: NOT-RUN / ENVIRONMENT-BLOCKED
```

The canonical data contract remains:

```text
%APPDATA%\CopyIt\copyit.db
```

There is no live JSON/SQLite dual-write path. Legacy JSON is migration input
only; the desktop app is the canonical SQLite writer and the native host reads
the same database.

## Historical release-candidate decision (superseded)

All local product, native-host, desktop compatibility, browser, security,
performance, install-lifecycle, and documentation gates are runtime-verified.
The pushed release candidate also has green CI, Windows Integration, and
Windows Certification workflows. The final release classification is:

```text
V1 RELEASE-CERTIFIED
```

Chrome Stable command-line automation remains explicitly:

```text
Chrome Stable automated functional gate: NOT-RUN / ENVIRONMENT-BLOCKED
```

The separate interactive Chrome acceptance passed, so the automation
limitation is not being hidden or relabelled as Chromium evidence.

The canonical data contract remains:

```text
%APPDATA%\CopyIt\copyit.db
```

There is no live JSON/SQLite dual-write path. Legacy JSON is migration input
only; the desktop app is the canonical SQLite writer and the native host reads
the same database.

## Historical release-candidate repository and toolchain state

| Item | Evidence |
| --- | --- |
| Extension branch | `main` |
| Extension starting SHA | `95c5b98cf3eae9ccaa40b2f4ae2e8c10534ce615` |
| Extension hardening commit | `707b50a` (`fix(ci): restore pinned Rust and certification gates`) |
| Release candidate evidence SHA | `2b8eaa1895076e03fce5ef53d1b2f23a960202e5` |
| GitHub Actions | CI run `33378008025`; Windows Integration run `33378008040`; Windows Certification run `33378008113` — all `success` |
| Desktop branch | `feature/copyit-v1-completion-20260828` |
| Desktop compatibility revision | `c36e138ce7a6153906347699384ec901369fc5b8` |
| OS | Windows 11 Pro, build 26200 |
| Node/npm | Node `v24.3.0` / npm `11.4.2` |
| Rust/Cargo | rustc/cargo `1.93.1`; rustup `1.29.0` |
| cargo-audit | `0.22.1` |
| Vite/Vitest | Vite `8.2.2` / Vitest `4.1.11` |
| Chrome Stable | `C:\Program Files\Google\Chrome\Application\chrome.exe`, `151.0.7922.174` |
| Edge Stable | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, `151.0.4129.107` |
| Playwright Chromium | bundled executable, `151.0.7922.34` |
| Extension ID | `mmiopnfmhmmlmhcdjklelfcdahmgchfc` |
| Native host | `com.quantdale.copyit` |
| Allowed origin | `chrome-extension://mmiopnfmhmmlmhcdjklelfcdahmgchfc/` only |

The extension ID is derived from the committed manifest key by
`scripts/get-extension-id.mjs`. It is not inferred from a browser run.

## Historical release-candidate evidence matrix

| Area | State | Evidence |
| --- | --- | --- |
| npm install | PASS | `npm ci` completed from the committed lockfile |
| Production build | PASS | `npm run build`; Vite 8.2.2 bundle created |
| TypeScript | PASS | `npx tsc --noEmit` |
| ESLint | PASS | `npm run lint`; 0 errors and 0 warnings |
| Vitest | PASS | 6 files, 23 tests |
| Playwright | PASS | `npm run e2e`; 12 tests |
| Rust fmt | PASS | `cargo fmt --manifest-path native-host/Cargo.toml -- --check` |
| Rust clippy | PASS | `cargo clippy ... --all-targets --all-features -- -D warnings` |
| Rust tests | PASS | 83 tests across 5 native-host suites |
| Native integration | PASS | `scripts/test-native-integration.ps1`; both Cargo invocations check `$LASTEXITCODE` |
| Failure-state suite | PASS | `npm run cert:failure`; 5/5, including clean unsupported-schema EOF and bounded oversized-frame rejection |
| Performance | PASS | popup shell 75.13 ms; first 100 metadata rows 67.47/39.75/78.79 ms at 100/1,000/10,000 rows; 10k title search 48.29 ms |
| Chrome install/origin | PASS | actual Chrome executable, manifest key, deterministic ID, exact origin |
| Chromium functional equivalence | PASS | bundled Chromium, 36/36; labelled Chromium only |
| Edge Stable functional E2E | PASS | actual Edge 151.0.4129.107, isolated fixture/native host, 36/36 |
| Chrome Stable automated functional E2E | NOT-RUN / ENVIRONMENT-BLOCKED | actual Chrome 151.0.7922.174; `ERR_BLOCKED_BY_CLIENT` while loading the unpacked page; command exits 2 |
| Chrome Stable manual acceptance | PASS | actual Chrome GUI `chrome://extensions` → Developer mode → Load unpacked using exact `extension/dist`; popup journey passed against an isolated synthetic fixture |
| Install lifecycle | PASS | isolated APPDATA/LOCALAPPDATA fixture: install, strict verify, Edge smoke, uninstall, DB/backup hash preservation, registry/assets cleanup, reinstall, strict verify, Edge smoke, final cleanup |
| Uninstall data preservation | PASS | synthetic DB and legacy backup hashes were unchanged; real user DB and existing legacy backup hashes were also unchanged |
| Desktop CopyIt compatibility | PASS | shared schema/vault source comparison, empty reconciliation test, full desktop tests, simulations, and release build |
| npm audit | PASS | `npm audit --audit-level=high` and `npm audit --omit=dev --audit-level=high`; zero vulnerabilities |
| Native cargo audit | PASS | `cargo audit` from `native-host`; no findings |
| Desktop cargo audit | PASS with documented warnings | command exits 0; five visible unmaintained/unsound warnings remain documented in the companion audit policy |

## Historical release-candidate Chrome evidence and investigation

The real-Chrome automation probe used only the installed executable and
isolated browser/data profiles. Playwright launch flags
`--load-extension` and `--disable-extensions-except` were rejected by branded
Chrome 151; Chrome emitted diagnostics that those switches are not allowed in
Google Chrome, and direct popup navigation returned
`net::ERR_BLOCKED_BY_CLIENT`. No extension-loading security policy or
`allowed_origins` check was weakened.

The manual acceptance used a separate visible Chrome profile and the actual
Chrome extensions manager. The directory was selected through the native
Chrome folder picker, not through command-line extension flags. The following
journey passed with a disposable synthetic database and no user data:

1. popup loaded with the expected ID and native host connection;
2. deterministic prompt list, search, and category filtering;
3. exact plaintext clipboard copy;
4. locked protected copy prompt;
5. wrong-password rejection with unchanged clipboard and no body in DOM;
6. successful unlock, exact protected copy, cleared password field;
7. relock and protected-access gating;
8. zero persistent browser storage, zero console errors, and safe isolated
   native log.

This is the required explicit result:

```text
Chrome Stable manual acceptance: PASS
```

The automated result remains separately recorded as
`NOT-RUN / ENVIRONMENT-BLOCKED`; it is never promoted to an automated PASS.

## Historical Chrome Stable manual acceptance procedure

Run this procedure only in an isolated Chrome profile and with a disposable
fixture root:

1. Run `npm ci` and `npm run build`.
2. Build the native host and register it with `scripts/install.ps1`.
3. Create the deterministic synthetic fixture with the `cert_fixture` helper;
   never point the fixture at the real `%APPDATA%\CopyIt`.
4. Open Chrome Stable and navigate to `chrome://extensions`.
5. Enable Developer mode, choose **Load unpacked**, and select the exact
   `extension/dist` directory.
6. Confirm the loaded extension ID is
   `mmiopnfmhmmlmhcdjklelfcdahmgchfc`.
7. Open the popup and verify native connectivity, list/search/category
   behavior, exact plaintext copy, locked protected-copy gating, wrong
   password rejection, successful unlock with the disposable fixture
   credential, exact protected copy, password clearing, relock, and blocked
   protected access after relock.
8. Inspect popup storage, console output, native stderr/logs, registry, and
   the exact single allowed origin. Record only booleans/counts/hashes; never
   record fixture bodies or credentials.

The result must be recorded separately from automated Chrome and Chromium
results as either `Chrome Stable manual acceptance: PASS` or
`Chrome Stable manual acceptance: NOT-RUN`.

## Historical cross-repository and data-safety evidence

- `SCHEMA_V1` in desktop `src/sqlite.rs` and native-host `src/db.rs` matched
  byte-for-byte: 1,656 bytes, schema version 1.
- Both sides use the same SQLite tables, protection CHECK constraint, WAL,
  foreign keys, busy timeout, and schema refusal behavior.
- Desktop `reconcile_snippets` explicitly deletes all rows for an empty
  in-memory library; `empty_reconcile_removes_every_snippet` passes.
- Native subprocess `host_observes_empty_canonical_library_after_clear_all`
  passes, proving clear-all visibility across the shared database.
- Desktop and native vault implementations use the shared Argon2id,
  XChaCha20-Poly1305, canary, nonce, salt, base64, and committed vector
  contract. Both repositories' relevant tests and release builds pass.
- Migration tests cover missing versus corrupt JSON, idempotence, atomic
  install, unique recoverable backups, IDs/order/counts, protected payload
  preservation, vault metadata, integrity checks, and unsupported schemas.
- All browser certification fixtures use temporary directories. The helper
  refuses to create a fixture when the temporary root is under `APPDATA`; the
  Windows certification workflow also requires `APPDATA` and `LOCALAPPDATA`
  to be descendants of `RUNNER_TEMP`.
- Native stdout is protocol-only in browser mode. Native stderr, browser
  console, isolated logs, and browser storage contained no protected body,
  password, derived key, or ciphertext value in the exercised journeys.

## Required commands

Extension repository, after `npm ci` and rebuilding native binaries:

```powershell
npm run build
npx tsc --noEmit
npm run lint
npm test
npx playwright install chromium
npm run e2e

cargo fmt --manifest-path native-host/Cargo.toml -- --check
cargo clippy --manifest-path native-host/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path native-host/Cargo.toml --all-targets --all-features
cargo build --release --manifest-path native-host/Cargo.toml

npm run mcp:preflight
npm run mcp:validate
npm run cert:native
npm run cert:failure
npm run cert:chromium
npm run cert:edge
npm run cert:chrome-install
npm run benchmark:performance
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-native-integration.ps1

npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
cargo audit
```

`cargo audit` is run from `native-host` because cargo-audit 0.22.1 does not
accept Cargo's `--manifest-path` option. The invalid option form is not used
as a substitute for the passing audit.

Companion desktop repository:

```powershell
cargo fmt -- --check
cargo check
cargo clippy --all-targets -- -D warnings
cargo test
cargo test --bin copyit sim_journeys -- --test-threads 1
cargo build --release
cargo audit
```

The Chrome Stable command-line probe is expected to return exit 2 when the

installed branded Chrome blocks unpacked extension automation. The workflow
accepts only that explicit environment-blocked code, labels the step
`NOT-RUN / ENVIRONMENT-BLOCKED`, and still fails on every other nonzero code.

## Browser and security policy

- `cert:chrome-install` proves only executable identity, manifest key,
  deterministic ID, and exact origin.
- `cert:chromium` is bundled Chromium evidence and must never be called Chrome
  evidence.
- `cert:edge` is real Edge Stable evidence.
- `cert:chrome` is real Chrome Stable automation evidence only; an environment
  block is nonzero and is not a functional PASS.
- Manual Chrome acceptance is a separate result and cannot be inferred from
  Chromium or Edge.
- The manifest requests only `nativeMessaging` and `clipboardWrite`; it has no
  `tabs`, `activeTab`, `scripting`, or broad host permissions.
- Uninstall removes only HKCU native-host registration and installed host
  assets. It does not delete `copyit.db`, WAL/SHM sidecars, or legacy backups.

## Historical evidence note

The older release-candidate sections below and the 2026-08-28 ledger
snapshot remain preserved as historical evidence. They are not the current
release decision. The post-release hardening section at the top is authoritative
for current `main`.

## Final certification record

```text
Extension hardening SHA: 61db731523b9af56b84953d1ee31e38a97ebf6b8
CI: success (33392921147)
Windows Integration: success (33392921206)
Windows Certification: success (33392921184)
Chrome Stable automated functional: NOT-RUN / ENVIRONMENT-BLOCKED
Chrome Stable manual acceptance: HISTORICAL-EVIDENCE (not rerun for hardening)
Edge Stable functional: PASS
Chromium functional: PASS (Chromium only)
Install lifecycle: PASS
Final decision: POST-RELEASE HARDENING COMPLETE
Open P0/P1/P2 defects: none
```
