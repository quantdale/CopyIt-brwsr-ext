# CopyIt Browser Extension V1 — Certification Ledger

**Status:** FINAL EVIDENCE RECORDED — implementation is complete, but the full release decision is **NOT CERTIFIED** because Chrome Stable functional automation is environment-blocked and manual Chrome acceptance was not performed.

**Campaign:** `2026-08-28` (`feature/copyit-v1-completion-20260828`)

**Repositories:** `quantdale/CopyIt-brwsr-ext` and sibling `quantdale/CopyIt`

The previous version of this file claimed that a Chromium-equivalent run was a real Chrome functional E2E. That claim is superseded. Git history preserves the earlier report; this file is the current evidence ledger and uses only the states `PASS`, `FAIL`, and `NOT-RUN / ENVIRONMENT-BLOCKED`.

## Release decision

**NOT CERTIFIED.** All deterministic, native-host, desktop, Chromium, Edge, install, and audit gates below were rerun. The installed Chrome executable was attempted separately and returned `ERR_BLOCKED_BY_CLIENT` while loading the unpacked extension. Manual Chrome acceptance was not performed, so no Chrome functional PASS is claimed.

The canonical data contract remains:

```text
%APPDATA%\CopyIt\copyit.db
```

There is no live JSON/SQLite dual-write path. Legacy JSON is read only for the verified, recoverable migration into SQLite.

## Environment and identity

| Item | Evidence |
| --- | --- |
| OS | Windows 11 Pro, build 26200 (local machine; record again in final report) |
| Node/npm | Node v24.3.0 / npm 11.4.2 |
| Rust/Cargo | rustc/cargo 1.93.1 |
| cargo-audit | 0.22.1 |
| Vite/Vitest | Vite 8.2.2 / Vitest 4.1.11 |
| Chrome Stable | `C:\Program Files\Google\Chrome\Application\chrome.exe`, 151.0.7922.174; install/origin PASS, functional automation environment-blocked |
| Edge Stable | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, 151.0.4129.101; functional PASS |
| Playwright Chromium | bundled executable, 151.0.7922.34; functional PASS as Chromium only |
| Extension ID | `mmiopnfmhmmlmhcdjklelfcdahmgchfc` |
| Native host | `com.quantdale.copyit` |
| Allowed origin | `chrome-extension://mmiopnfmhmmlmhcdjklelfcdahmgchfc/` only |

The extension ID is derived from the committed manifest key by `scripts/get-extension-id.mjs`; it is not inferred from a browser run.

## Current evidence matrix

| Area | State | Required evidence |
| --- | --- | --- |
| Desktop SQLite empty-library reconciliation | PASS | `empty_reconcile_removes_every_snippet`, desktop full tests, and native clear-all subprocess test |
| Shared SQLite schema and vault compatibility | PASS | Native-host tests, desktop tests, deterministic fixture, migration/vault vectors |
| Extension build/type/lint/unit | PASS | build, TypeScript, lint, and 24 Vitest tests |
| Popup mock E2E | PASS | 12 Playwright tests, including stale-response, protected retry, pagination, accessibility, and failure-state regressions |
| Performance/accessibility probe | PASS with informational target note | popup shell 382 ms; native first-page metadata under 1 s for 100/1,000/10,000 rows; 10k search 143 ms versus the ~100 ms target |
| Native host formatting/clippy/tests | PASS | fmt, clippy `-D warnings`, 79 unit + 4 subprocess tests |
| Native integration wrapper | PASS | `scripts/test-native-integration.ps1` propagated both Cargo suites |
| Failure-state certification | PASS | wrong origin, future schema, and oversized frame observed fail-closed; 4/4 |
| Chrome install/origin verification | PASS | actual Chrome executable, manifest key, deterministic ID, exact origin |
| Chromium functional equivalence | PASS | 36/36 with bundled Chromium explicitly labelled Chromium |
| Edge Stable real functional E2E | PASS | actual Edge Stable, isolated fixture/native host, 36/36 |
| Chrome Stable real functional E2E | NOT-RUN / ENVIRONMENT-BLOCKED | actual Chrome only; `ERR_BLOCKED_BY_CLIENT` prevented popup load |
| Chrome manual acceptance | NOT-RUN | no human Chrome session was performed in this campaign |
| Install/verify/uninstall/reinstall lifecycle | PASS | database hash preserved; registry and installed host cleaned, then reinstall verified |
| Supply-chain/advisory evidence | PASS with documented desktop warnings | npm audits clean; native audit clean; desktop audit exception/warnings documented |

## Required functional behavior

The final evidence must show all of the following against the production bundle and production native host paths:

- compact title-only rows; no prompt body preview in the DOM or browser storage;
- optional description available only through the text-only tooltip;
- search and category filtering with stale response protection;
- exact plaintext copy and visible copy feedback;
- protected copy opens unlock, wrong passwords do not copy, successful unlock retries the original snippet exactly once, and the password field is cleared;
- lock failures leave the UI in the previous state and show an error;
- native host stdout contains protocol frames only, while errors are bounded and safe;
- no prompt bodies, passwords, derived keys, or ciphertext secrets are written to logs.

## Required data-safety evidence

The final report must include deterministic evidence for:

- missing versus corrupt legacy JSON behavior;
- idempotent migration, recovery backup, atomic install, counts, IDs, ordering, protection metadata, vault metadata, and `PRAGMA integrity_check`;
- canonical SQLite access from both desktop and native host;
- deleting the final desktop snippet and observing an empty native-host list;
- preservation of `%APPDATA%\CopyIt\copyit.db`, WAL/SHM sidecars, and legacy backups during uninstall;
- disposable fixture directories for all certification runs, including CI. No certification fixture may write the user's real `%APPDATA%\CopyIt` database.

## Commands and evidence capture

Run from the extension repository after `npm ci` and after rebuilding the native binaries:

```powershell
npm run build
npx tsc --noEmit
npm test
npm run lint
npx playwright install chromium
npm run e2e

cargo fmt --manifest-path native-host/Cargo.toml -- --check
cargo clippy --manifest-path native-host/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path native-host/Cargo.toml --all-targets --all-features
cargo build --release --manifest-path native-host/Cargo.toml

npm run cert:chrome-install
npm run cert:native
npm run cert:chromium
npm run cert:edge
npm run cert:chrome
npm run cert:failure
npm run benchmark:performance
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-native-integration.ps1

npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
cargo audit --manifest-path native-host/Cargo.toml
```

Run the companion desktop gates from `D:\Documents\tryPython\CopyIt`:

```powershell
cargo fmt -- --check
cargo check
cargo clippy --all-targets -- -D warnings
cargo test
cargo test --bin copyit sim_journeys -- --test-threads 1
cargo build --release
```

Record each command's exit code and the exact browser/tool version. Do not turn an environment block, timeout, manual process kill, or skipped optional smoke into PASS. The full command-by-command record is in `docs/implementation/EVIDENCE_LEDGER_2026-08-28.md`.

## Browser result policy

- `cert:chrome-install` proves only the executable, manifest key, deterministic ID, and origin contract.
- `cert:chromium` is functional Chromium evidence and must never be called Chrome evidence.
- `cert:edge` is real Edge evidence.
- `cert:chrome` is real Chrome Stable functional evidence only. It must exit nonzero with `NOT-RUN / ENVIRONMENT-BLOCKED` when Chrome cannot load the unpacked extension under automation.
- Manual Chrome acceptance is a separate result and requires an actual Chrome session; it cannot be inferred from Chromium or Edge.

## Historical report note

The superseded report was intentionally replaced because it conflated Chromium-equivalent evidence with real Chrome certification and logged synthetic secret values in some stale binaries. Refer to Git history for the original text; do not use its READY verdict or PASS counts as current evidence.

## Final certification record

This section records the final coordinated commits and their truthful evidence:

```text
Extension branch: `feature/copyit-v1-completion-20260828`
Extension final commit: `fb768343294456f864f1493f001d95bc4052822d`
Desktop branch: `feature/copyit-v1-completion-20260828`
Desktop final commit: `c36e138ce7a6153906347699384ec901369fc5b8`
Final decision: NOT CERTIFIED — Chrome Stable functional/manual evidence unavailable
Chrome Stable functional: NOT-RUN / ENVIRONMENT-BLOCKED (`ERR_BLOCKED_BY_CLIENT`)
Chrome manual acceptance: NOT-RUN
Edge Stable functional: PASS (36/36)
Install lifecycle: PASS
Desktop simulation: PASS (18/18)
Open P0/P1 defects:
  none; remaining limitation is environment/manual Chrome evidence, not an identified product defect
```
