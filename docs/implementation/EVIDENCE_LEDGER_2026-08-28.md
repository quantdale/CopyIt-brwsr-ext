# CopyIt V1 Completion Evidence Ledger — 2026-08-28

This ledger records executable evidence for the coordinated browser-extension
and desktop campaign. It intentionally separates source evidence, runtime
evidence, and environment-blocked evidence. No prompt body, password, key, or
ciphertext is recorded here.

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
Final extension SHA: `cdd376743a1ebc555d11f8b38ee8c152d58ab387`.
