# CopyIt V1 Completion Evidence Ledger — 2026-08-28

This ledger records executable evidence for the coordinated browser-extension
and desktop campaign. It intentionally separates source evidence, runtime
evidence, and environment-blocked evidence. No prompt body, password, key, or
ciphertext is recorded here.
## Post-release hardening rerun — 2026-08-31

This section is authoritative for the current `main` state after the
post-release hardening campaign. The prior release rerun remains below as
historical evidence. The hardening commit is
`61db731523b9af56b84953d1ee31e38a97ebf6b8`, based on the certified
`fdaeeb4` release. No prompt body, password, derived key, or ciphertext is
recorded here.

### Current hardening gates

| Command / gate | Result | Evidence |
| --- | --- | --- |
| `npm run build` | PASS | icon validation, TypeScript, and Vite production bundle |
| `npx tsc --noEmit` | PASS | current source |
| `npm run lint` | PASS | 0 errors, 0 warnings |
| `npm test` | PASS; 32 tests | 6 Vitest files |
| `npm run e2e` | PASS; 24 tests | production bundle; timeout, disconnect, late-response, unlock, and popup-race coverage |
| native `cargo fmt` | PASS | `--check` |
| native `cargo clippy` | PASS | all targets/features, `-D warnings` |
| native `cargo test` | PASS; 85 unit + 6 subprocess tests | current native host |
| native release build | PASS | release host built |
| native integration wrapper | PASS | both Cargo suites |
| `npm run cert:failure` | PASS; 5/5 | wrong origin, unsupported schema, oversized frame |
| `npm run cert:chromium` | PASS | bundled Chromium; Chromium evidence only |
| `npm run cert:edge` | PASS | real Edge Stable; isolated fixture |
| `npm run benchmark:performance` | PASS | shell 51.45 ms; first-page and 10k-search targets met |
| `npm audit` (both requested modes) | PASS | zero vulnerabilities |
| native `cargo audit` | PASS | no findings |
| companion CopyIt gates | PASS | shared schema/vault compatibility, tests, simulations, and release build |

### Current hardening behavior evidence

- Retryable migration/database initialization errors are no longer cached;
  the same host process recovers after the migration lock clears. Terminal
  legacy/schema failures remain cached and fail closed.
- Repeated log rotation replaces the prior `.old` file and truncates the
  active file if replacement is unavailable; writes remain capped at
  256 KiB.
- Browser responses require protocol version 1, a valid request ID, boolean
  `ok`, and a complete success or failure envelope. Unknown or late IDs are
  ignored safely.
- Unlock uses a 10-second method-specific timeout. Measurements stayed below
  340 ms for first attempts and were about 2.33 s for a correct attempt after
  six failures; timeout recovery checks `hello` before changing UI state.
- The vault password input uses `autocomplete="off"`. Browser password
  managers may override this hint; no saved-credential profile was configured
  for this hardening rerun, so manager-specific suppression is not claimed.
- Search covers title, description, category, and plaintext bodies only.
  Protected bodies remain unavailable to list/search and are never decrypted
  during listing.
- Icon validation confirms exact 16×16, 48×48, and 128×128 RGBA PNG assets.

### Current install and workflow evidence

An isolated lifecycle using disposable `APPDATA`/`LOCALAPPDATA` passed install,
strict verification, native/failure/Chromium/Edge certification, performance,
uninstall data-preservation hashes, reinstall, strict verification, and final
cleanup. The real Chrome install/origin gate passed against the installed
Chrome executable and exact deterministic origin. Branded Chrome functional
automation remains `NOT-RUN / ENVIRONMENT-BLOCKED`; the prior GUI acceptance is
historical evidence and was not rerun for this hardening-only pass.

The post-push workflows for `61db731` all concluded `success`:

```text
CI: 33392921147
Windows Integration: 33392921206
Windows Certification: 33392921184
```

### Current hardening classification

```text
POST-RELEASE HARDENING COMPLETE
```

## Prior release rerun — 2026-08-31 (superseded)

This section supersedes the older snapshot below. It records the final
campaign rerun on extension `main` after starting at
`95c5b98cf3eae9ccaa40b2f4ae2e8c10534ce615`. The CI/certification hardening
commit is `707b50a` (`fix(ci): restore pinned Rust and certification gates`).
The companion contract was verified at
`c36e138ce7a6153906347699384ec901369fc5b8` on branch
`feature/copyit-v1-completion-20260828`. No prompt body, password, derived
key, or ciphertext is recorded here.

### Current environment

| Tool or runtime | Version / identity |
| --- | --- |
| OS | Windows 11 Pro build 26200 |
| Node/npm | Node `v24.3.0`, npm `11.4.2` |
| Rust/rustup/Cargo | rustc/cargo `1.93.1`, rustup `1.29.0` |
| cargo-audit | `0.22.1` |
| Vite/Vitest | Vite `8.2.2`, Vitest `4.1.11` |
| Chrome Stable | `C:\Program Files\Google\Chrome\Application\chrome.exe`, `151.0.7922.174` |
| Edge Stable | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, `151.0.4129.107` |
| Playwright Chromium | bundled executable, `151.0.7922.34` |
| Extension ID | `mmiopnfmhmmlmhcdjklelfcdahmgchfc` |
| Native host | `com.quantdale.copyit` |
| Allowed origin | `chrome-extension://mmiopnfmhmmlmhcdjklelfcdahmgchfc/` only |

### Current runtime gates

| Command / gate | Result | Evidence |
| --- | --- | --- |
| `npm ci` | PASS | clean lockfile install |
| `npm run build` | PASS | production Vite bundle |
| `npx tsc --noEmit` | PASS | TypeScript check |
| `npm run lint` | PASS | 0 errors, 0 warnings |
| `npm test` | PASS; 23 tests | 6 Vitest files |
| `npx playwright install chromium` | PASS | bundled browser available |
| `npm run e2e` | PASS; 12 tests | real built popup bundle; race, retry, lock failure, accessibility, and failure-state coverage |
| native `cargo fmt` | PASS | `--check` |
| native `cargo clippy` | PASS | all targets/features, `-D warnings` |
| native `cargo test` | PASS; 83 tests | 5 suites |
| native release build | PASS | release host built |
| native integration wrapper | PASS | both Cargo commands check `$LASTEXITCODE`; subprocess suite passed |
| `npm run mcp:preflight` | PASS | chrome-devtools and context7 discovered |
| `npm run mcp:validate` | PASS; 2/2 | capability validation |
| `npm run cert:native` | PASS; 28 pass, 1 skip | isolated fixture; pagination skipped because fixture has 3 rows |
| `npm run cert:failure` | PASS; 5/5 | wrong origin, unsupported schema including clean EOF, oversized frame |
| `npm run cert:chrome-install` | PASS | Chrome executable/version, deterministic ID, exact origin |
| `npm run cert:chromium` | PASS; 36/36 | bundled Chromium only |
| `npm run cert:edge` | PASS; 36/36 | actual Edge Stable 151.0.4129.107 |
| `npm run benchmark:performance` | PASS | shell 75.13 ms; first 100 metadata 67.47/39.75/78.79 ms at 100/1,000/10,000 rows; 10k search 48.29 ms |
| `npm audit --audit-level=high` | PASS | zero vulnerabilities |
| `npm audit --omit=dev --audit-level=high` | PASS | zero vulnerabilities |
| `cargo audit` in `native-host` | PASS | no findings |
| desktop `cargo audit` | PASS with documented warnings | exit 0; five visible unmaintained/unsound warnings remain documented in the companion policy |

### Chrome evidence

The installed Chrome command-line functional probe is explicitly
`NOT-RUN / ENVIRONMENT-BLOCKED`. Chrome 151 rejected the Playwright
`--load-extension` and `--disable-extensions-except` switches, and popup
navigation returned `net::ERR_BLOCKED_BY_CLIENT`. The probe used no Chromium
substitution and did not weaken the manifest key, native allowed origin, or
browser security settings.

The separate real Chrome manual acceptance passed. In a disposable visible
Chrome profile, the extension was loaded through the actual
`chrome://extensions` Developer mode and native folder picker using the exact
`extension/dist` bundle. The popup then passed native connectivity, list,
search, category, exact plaintext copy, locked protected copy, wrong-password
rejection without clipboard/body leakage, successful unlock, exact protected
copy, password clearing, relock, storage checks, console checks, and isolated
native-log checks.

```text
Chrome Stable automated functional gate: NOT-RUN / ENVIRONMENT-BLOCKED
Chrome Stable manual acceptance: PASS
```

### Cross-repository and data-safety evidence

- Desktop and native-host `SCHEMA_V1` literals matched byte-for-byte: 1,656
  bytes, schema version 1.
- Desktop `empty_reconcile_removes_every_snippet` and native
  `host_observes_empty_canonical_library_after_clear_all` passed.
- Desktop fmt/check/clippy/tests/simulations/release build passed:
  `cargo test` 146 and `sim_journeys` 18.
- Native and desktop migration/vault tests passed, including corrupt versus
  missing JSON, idempotence, recoverable backups, atomic install, protected
  payload preservation, schema refusal, WAL/integrity checks, and the shared
  vault vector.
- Certification fixtures used temporary directories. The helper refuses a
  fixture root under `APPDATA`; Windows certification also sets and validates
  disposable `APPDATA`/`LOCALAPPDATA` descendants of `RUNNER_TEMP`.
- The isolated lifecycle passed install, strict verify, real Edge smoke,
  uninstall, registry/assets cleanup, DB and legacy-backup hash preservation,
  reinstall, strict verify, second Edge smoke, and final cleanup. Existing
  real-user DB and legacy backup hashes matched before and after the local
  certification install cleanup.
- Native stdout remained protocol-only; no exercised browser storage,
  console, stderr, or isolated log contained protected plaintext, password,
  derived key, or ciphertext.

The first one-off local lifecycle probe stopped on a test-harness assertion
that checked the empty parent directory rather than the installed host
directory. The assertion was corrected before the release-like lifecycle was
rerun; the corrected lifecycle and the committed workflow check the exact
installed host path and passed.

### Workflow policy

All three workflows now pass `toolchain: 1.93.1` and
`components: rustfmt, clippy` to the pinned dtolnay action. Actions remain
immutable SHA references. Certification cleanup still runs with `if:
always()`, while reinstall runs only with `if: success()`. The Chrome
automation wrapper converts only the script's explicit exit code 2 to a
successful workflow step labelled `NOT-RUN / ENVIRONMENT-BLOCKED`; all other
nonzero results fail the job.

The required post-push GitHub Actions runs are runtime-verified for release
candidate `2b8eaa1895076e03fce5ef53d1b2f23a960202e5`: CI
`33378008025`, Windows Integration `33378008040`, and Windows Certification
`33378008113` all concluded `success`.

The final release classification is:

```text
V1 RELEASE-CERTIFIED
```

## Historical 2026-08-28 snapshot (superseded)

## Scope and starting points

| Repository | Branch | Starting SHA | Scope |
| --- | --- | --- | --- |
| `quantdale/CopyIt-brwsr-ext` | `feature/copyit-v1-completion-20260828` | `c5359aa301191de508a09414b62c35cc9d987fdc` | extension, native host, protocol, install tooling, certification |
| `quantdale/CopyIt` | `feature/copyit-v1-completion-20260828` | `659603af133c9022446e8a5a553dd416dfeaa129` | desktop SQLite writer and compatibility tests |

The companion repository contained four pre-existing untracked developer log
files (`desktop-*.log`); they were preserved and are not release artifacts.

## Environment

| Tool or runtime | Version / identity |
| --- | --- |
| OS | Windows 11 Pro build 26200 |
| Node/npm | Node `v24.3.0`, npm `11.4.2` |
| Rust/Cargo | `rustc 1.93.1`, Cargo `1.93.1` |
| cargo-audit | `0.22.1` |
| Vite/Vitest | Vite `8.2.2`, Vitest `4.1.11` |
| Chrome Stable | `C:\Program Files\Google\Chrome\Application\chrome.exe`, `151.0.7922.174` |
| Edge Stable | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, `151.0.4129.101` |
| Playwright Chromium | bundled executable, `151.0.7922.34` |
| Extension ID | `mmiopnfmhmmlmhcdjklelfcdahmgchfc` |
| Native host | `com.quantdale.copyit` |
| Canonical data | `%APPDATA%\CopyIt\copyit.db` |

The native host manifest allows exactly:
`chrome-extension://mmiopnfmhmmlmhcdjklelfcdahmgchfc/`.

## Baseline before implementation changes

The baseline was run after pulling the latest `main` state and before the
campaign edits. Extension build, TypeScript, lint, unit tests, mock E2E,
native-host Rust gates, desktop Rust gates, and desktop simulations passed.
The baseline npm audit reported six development-tool vulnerabilities through
the old Vite/Vitest/static-copy dependency set; production-only audit was
clean. The old native subprocess suite had three tests and the certification
report incorrectly described Chromium-equivalent execution as real Chrome.
Those findings drove the changes below.

## Runtime evidence at the current implementation

| Command / gate | Result | Evidence pointer |
| --- | --- | --- |
| `npm ci` | PASS; clean install | `package-lock.json` |
| `npm audit --audit-level=high` | PASS; 0 vulnerabilities | npm lockfile and audit output |
| `npm audit --omit=dev --audit-level=high` | PASS; 0 vulnerabilities | npm lockfile and audit output |
| `npm run build` | PASS; Vite 8.2.2 production bundle | `vite.config.mts`, `extension/dist/` (ignored build output) |
| `npx --no-install tsc --noEmit` | PASS | `tsconfig.json` |
| `npm run lint` | PASS | `eslint.config.mjs` |
| `npm test -- --run` | PASS; 24 tests | `extension/tests/` |
| `npm run e2e` | PASS; 12 Playwright tests | `tests/e2e/popup.spec.ts` |
| `npm run benchmark:performance` | PASS; popup shell 382.39 ms; native first-page metadata 288.10/287.14/395.19 ms for 100/1,000/10,000 rows; 10k search 143.43 ms | `tests/performance-benchmark.mjs` |
| native host fmt/clippy/tests | PASS; 79 unit + 4 subprocess tests | `native-host/` |
| `scripts/test-native-integration.ps1` | PASS; wrapper propagated both Cargo suites | `scripts/test-native-integration.ps1` |
| desktop fmt/check/clippy | PASS | sibling `quantdale/CopyIt` |
| desktop `cargo test` | PASS; 146 tests | sibling `quantdale/CopyIt` |
| desktop `sim_journeys` | PASS; 18 deterministic simulations | sibling `quantdale/CopyIt/src/sim/` |
| desktop release build | PASS | sibling `quantdale/CopyIt/target/release/` (ignored output) |
| `npm run cert:failure` | PASS; 4/4 | `tests/test-failure-states.mjs` |
| `npm run cert:chrome-install` | PASS | `tests/chrome-install-origin-verification.mjs` |
| `npm run cert:native` | PASS; 28, skip 1 due only 3 fixture rows | `tests/real-native-host-test.mjs` |
| `npm run cert:chromium` | PASS; 36/36, bundled Chromium explicitly labelled | `tests/chromium-functional-e2e.mjs` |
| `npm run cert:edge` | PASS; real Edge Stable 36/36 | `tests/real-edge-e2e.mjs` |
| `npm run cert:chrome` | NOT-RUN / ENVIRONMENT-BLOCKED; actual Chrome reached `ERR_BLOCKED_BY_CLIENT` while loading the unpacked extension | `tests/real-chrome-e2e.mjs` |

The Chrome install/origin gate used the installed Chrome executable and proved
the manifest key, derived ID, and exact origin. The functional Chrome gate was
then attempted separately with that same executable. It did not substitute
Chromium, and its nonzero result is not counted as a functional pass.

## Data-safety and cross-repository evidence

- The desktop empty-library regression test
  `empty_reconcile_removes_every_snippet` passes. The native subprocess test
  `host_observes_empty_canonical_library_after_clear_all` passes after deleting
  the canonical SQLite rows, proving clear-all is visible to the host.
- Native and desktop migration/vault tests pass, including corrupt-versus-
  missing legacy input, idempotent migration, unique backups, row/order/ID
  preservation, protected payload byte preservation, vault metadata, schema
  refusal, SQLite integrity checks, and the shared vault test vector.
- The canonical database is `%APPDATA%\CopyIt\copyit.db`; JSON is migration
  input only. No live JSON/SQLite dual-write path was added.
- The deterministic fixture uses a temporary `APPDATA` and `LOCALAPPDATA`
  directory. Fixture output, browser console capture, native stderr, and the
  isolated native log contain no synthetic body, password, derived key, or
  ciphertext values.
- Install/verify/uninstall/reinstall passed. Before uninstall, the existing
  canonical database was present at 45,056 bytes with SHA-256
  `99CF73568C16E6D3FE0B0F1610C6E9B512140795681FD65A43F7B9F0B2675BB3`; after
  uninstall the same database remained, registry entries were absent, and the
  installed host directory was absent. Reinstall and strict verification then
  passed.

## Supply-chain and workflow decisions

- Native-host `cargo audit`: PASS with no findings.
- Desktop `cargo audit`: PASS after explicitly documenting the Windows-only
  `webbrowser` advisory exception in `.cargo/audit.toml`; five visible
  unmaintained/unsound warnings remain allowed and documented. The
  `event-listener` chain is absent from the Windows target tree.
- Vite/Vitest and coverage tooling were upgraded to patched exact versions and
  the unused static-copy plugin was removed.
- Node and Rust toolchains are pinned in `.node-version` and
  `rust-toolchain.toml`; GitHub Actions use immutable commit SHAs.
- The extension CI desktop checkout is pinned to companion commit
  `c36e138ce7a6153906347699384ec901369fc5b8`.

## Final release decision

Implementation and all deterministic, native, desktop, Chromium, Edge, and
performance/accessibility gates are runtime-verified. The 10k title-search
measurement was 143.43 ms against the plan's informational ~100 ms target;
the host remained bounded and the result was not treated as a release-blocking
failure. Full Chrome Stable certification is not claimed:
functional automation is environment-blocked and the required manual Chrome
acceptance was not performed in this session. Therefore the truthful decision
for this evidence set is **NOT CERTIFIED** pending a real Chrome functional or
manual acceptance record.

Final desktop SHA: `c36e138ce7a6153906347699384ec901369fc5b8`.
Final extension implementation SHA: `fb768343294456f864f1493f001d95bc4052822d`.
