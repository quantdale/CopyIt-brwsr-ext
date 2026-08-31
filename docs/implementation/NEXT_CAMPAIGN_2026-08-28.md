# CopyIt Browser Extension — Verified Audit + Completion Campaign

**Date:** 2026-08-28  
**Repository:** `quantdale/CopyIt-brwsr-ext`  
**Audited baseline:** `main` at `3f56f5d0594fde87329e0877efe854da0a37c12b`  
**Companion contract inspected:** `quantdale/CopyIt`, branch `feature/sqlite-browser-extension-compat`  
**Campaign type:** **Combined implementation + hardening**, hardening-dominant
**Execution note (2026-08-31):** The remediation campaign has been executed
from the audited baseline. The findings and unverified runtime statements
below describe the pre-remediation audit snapshot; current executable results
are recorded in `EVIDENCE_LEDGER_2026-08-28.md` and `../certification.md`.

## 1. Executive decision

V1 is substantially implemented. The repository contains the Manifest V3 popup, Rust Native Messaging host, canonical SQLite path, verified legacy migration design, vault compatibility, Windows install/uninstall tooling, Chrome/Edge registration, mock and real-browser harnesses, CI workflows, and release documentation.

A broad feature campaign is therefore not justified.

However, the project is **not eligible for an unconditional "100% complete / fully certified" conclusion yet**. This audit found one high-impact cross-repository correctness defect plus multiple release-evidence and test-integrity defects that can create false confidence. The correct next phase is a severity-first completion campaign that fixes those verified defects, closes certification truth gaps, then performs targeted hardening and final release certification.

Preserve the established V1 product contract unless executable evidence requires a compatible correction:
- read/search/filter/copy from the desktop CopyIt library;
- protected-copy unlock with the key held only in native-host memory;
- one canonical `%APPDATA%\CopyIt\copyit.db`;
- minimal extension permissions;
- exact deterministic extension/native-host origin binding;
- no website injection and no second browser-side prompt store.

## 2. Audit scope and evidence policy

The audit enumerated **75 repository paths** across:
- `.agent/`;
- `.github/workflows/`;
- root configuration and lockfiles;
- `docs/`;
- `extension/` source, manifest, assets, and tests;
- `native-host/` source, Cargo metadata, examples, and subprocess tests;
- `protocol/`;
- `scripts/`;
- `tests/`.

The companion desktop branch was also inspected where it defines the shared SQLite/vault contract.

### Evidence classes

Use these labels in all work and the final certification:

1. **VERIFIED-CODE** — directly established from the current source tree.
2. **VERIFIED-CROSS-REPO** — directly established by comparing the browser/native-host repo with the companion desktop branch.
3. **HISTORICAL-EVIDENCE** — recorded by an older certification report or commit, but not rerun at this audited HEAD.
4. **RUNTIME-VERIFIED** — rerun by the executing agent at the current SHA with command, environment, exit code, and artifacts recorded.
5. **NOT-RUN / ENVIRONMENT-BLOCKED** — not executed; never convert this to PASS.
6. **FAILED** — executed and did not satisfy the gate.

The planning session could inspect the repository through the connected GitHub API but could not execute a fresh Windows checkout/build in its sandbox. No status checks or workflow runs were available for the current HEAD through the connector. Therefore **current runtime/CI green status is unverified by this audit**. Historical PASS counts in `docs/certification.md` remain historical evidence only until rerun.

## 3. Verified positive state

These areas are already materially implemented and should not be rewritten without cause:

- **Native-message framing:** request frames are capped before allocation; response frames are capped below Chromium's Native Messaging limit.
- **Protocol parsing:** stable protocol/error envelopes and unknown-field rejection exist.
- **Origin defense:** release builds validate the exact deterministic extension origin; the test-only environment override is debug-only.
- **SQLite contract:** host refuses a newer unsupported schema, uses bound parameters, WAL, foreign keys, a busy timeout, and bounded pagination.
- **Migration architecture:** legacy corruption is distinguished from missing data; import is built in a temporary DB, verified, synced, atomically installed, reopened, and only then are legacy sources backed up.
- **Vault contract:** Argon2id + XChaCha20-Poly1305 parameters, canary, salt/nonce sizes, and encoding are aligned with the companion desktop branch.
- **Cross-repo schema:** the inspected host and desktop `SCHEMA_V1` strings are byte-for-byte identical.
- **Minimal browser permissions:** current manifest requests only `nativeMessaging` and `clipboardWrite`.
- **Strict installation verification:** the current verifier checks the deterministic ID, host manifest, exact single allowed origin, registry paths, host binary, and self-test.

These are preservation constraints for the campaign.

## 4. Severity-ranked remediation map

### P0 / Critical

No P0 is proven from static inspection.

Immediately promote and stop lower-priority work if execution discovers:
- data loss or destructive migration;
- vault plaintext/password/key leakage;
- release-origin bypass;
- unsafe overwrite of corrupt/newer data;
- remotely or locally exploitable command/code injection;
- a normal install path that cannot launch the host at all.

### P1 / High — must close before any READY decision

#### P1-01 — Desktop empty-library reconciliation leaves stale browser rows

**Subsystem:** shared SQLite / companion desktop integration  
**Affected:** companion `quantdale/CopyIt/src/sqlite.rs`, browser/native-host read path and cross-repo tests  
**Evidence:** VERIFIED-CROSS-REPO

**Observed problem:** `reconcile_snippets(conn, snips)` deletes database rows absent from the in-memory list only inside `if !snips.is_empty()`. When the desktop library becomes empty, no DELETE executes.

**Root cause:** the empty input case is excluded to avoid constructing an empty `NOT IN (...)` clause, but no separate `DELETE FROM snippets` path exists.

**Impact:** after a user deletes all prompts in desktop CopyIt, stale rows can remain in `copyit.db` and continue appearing in the browser extension. This violates the "one canonical library" contract and the method's documented full-reconciliation semantics.

**Required remediation:**
- in the companion desktop repo, make an empty reconciliation explicitly delete all snippet rows in the same transaction;
- preserve categories/config/vault according to existing desktop semantics;
- add a regression test that seeds >=2 snippets, reconciles with an empty slice, and proves `load_all_snippets` returns zero;
- add/extend cross-repo integration evidence that the native host sees zero snippets after the desktop clears the library.

**Acceptance:** desktop clear-all leaves zero SQLite snippets and browser/native-host listing returns zero; tests prevent recurrence.

#### P1-02 — CI "Real Chrome E2E" can PASS without Chrome or real Chrome execution

**Subsystem:** certification integrity  
**Affected:** `tests/real-chrome-e2e.mjs`, `.github/workflows/windows-certification.yml`, `package.json`, certification docs  
**Evidence:** VERIFIED-CODE

**Observed problem:** under `CI`, `real-chrome-e2e.mjs` performs a lightweight manifest/optional-binary check and exits 0 even when Chrome is absent. The workflow step is nevertheless named "Real Chrome E2E".

Local execution verifies the Chrome binary but then runs functional tests using Playwright's bundled Chromium while labeling the certification browser "Chrome".

**Impact:** a green release gate can be interpreted as real Chrome Stable functional proof when it is not. This is a release-evidence integrity failure even if the product itself works in Chrome.

**Required remediation:**
- first attempt a reliable, security-preserving real Chrome Stable automation path on Windows;
- if real Chrome Stable E2E remains technically blocked, split the evidence into explicitly named gates:
  - `chrome-install-origin-verification`;
  - `chromium-functional-equivalence`;
  - `edge-stable-real-e2e`;
  - `chrome-stable-manual-acceptance` (NOT automated PASS);
- a missing Chrome binary must be **NOT-RUN/FAIL according to gate policy**, never "REAL CHROME E2E PASS";
- never present bundled Chromium results as a literal real-Chrome test;
- capture executable path/version and diagnostics in certification artifacts.

**Acceptance:** every Chrome-related CI/doc label says exactly what executable and behavior were tested; no green "real Chrome E2E" is possible without a real Chrome functional run.

#### P1-03 — Oversized-frame subprocess certification has a false-PASS branch

**Subsystem:** failure-state certification  
**Affected:** `tests/test-failure-states.mjs`  
**Evidence:** VERIFIED-CODE

**Observed problem:** if the host remains alive after an oversized length prefix, the test kills the process itself and still records PASS.

**Impact:** the release-level malformed-frame gate can report success even if the expected rejection behavior did not occur. Unit tests in `framing.rs` reduce underlying product risk but do not make this certification assertion valid.

**Required remediation:**
- require observed host termination / connection closure / deterministic rejection within a bounded timeout;
- if the test must kill the host because the expected condition did not occur, record FAIL;
- assert exit behavior and ensure no oversized allocation/hang;
- retain the lower-level Rust framing tests.

**Acceptance:** deliberately weakening oversize rejection makes the subprocess certification fail.

#### P1-04 — Certification report materially overstates Chrome evidence

**Subsystem:** release documentation / provenance  
**Affected:** `docs/certification.md`  
**Evidence:** VERIFIED-CODE

**Observed problem:** the report declares the project fully certified for real Chrome while describing bundled Chromium as the functional executor. It also contains technically misleading equivalence wording and stale version-specific evidence.

**Required remediation:**
- preserve the old report as historical evidence or mark it superseded;
- remove "fully real-Chrome certified" language unless literal real-Chrome E2E exists;
- record current exact lockfile/tool/browser versions at certification time;
- use PASS / FAIL / NOT-RUN, not prose that converts blocked coverage into PASS.

**Acceptance:** a reader can determine exactly which browser binary ran every gate and which claims remain manual/environment-limited.

### P2 / Medium — close during hardening

#### P2-01 — Dedicated subprocess integration command ignores its own failure

**Affected:** `scripts/test-native-integration.ps1`

The second `cargo test ... --test subprocess` non-zero exit currently prints a message instead of throwing. Make every required command fail closed. Keep the first broad `cargo test`, but do not rely on redundancy to excuse a false-green dedicated gate.

#### P2-02 — Protected-copy retry looks up a button by ID although its label contains title

**Affected:** `extension/src/popup.ts`

After vault unlock, code queries `button[aria-label="Copy <id>"]`, but buttons are labeled `Copy <title>`. The flow falls back to a direct clipboard write, so the copy can work while bypassing the intended button feedback path.

Fix by storing an explicit pending copy object/button reference (or another stable ID/data attribute), not by querying user-visible label text. Test actual success feedback and exactly-once retry.

#### P2-03 — Manual lock failure is silently swallowed

**Affected:** `extension/src/popup.ts`

If `lockVault` fails, the request error is swallowed with no user-visible state. Keep the UI truthful and provide concise failure feedback/retry semantics. Never claim "locked" until the host confirms it.

#### P2-04 — Several unit tests test replicas, not production behavior

**Affected:** `extension/tests/popup.test.ts`, `extension/tests/dom.test.ts`, `extension/tests/native-client.test.ts`

Examples include manually simulating the copy checkmark, reimplementing debounce/cap math, testing a row helper not used by the actual popup renderer, and a "stale responses" test that explicitly does not test popup generation discard.

Replace low-value replicas with tests against exported production seams or the real built-bundle E2E. Add regression tests for P2-02/P2-03.

#### P2-05 — Installer/dev-install command failure handling is inconsistent

**Affected:** `scripts/install.ps1`, `scripts/dev-install.ps1`

Add explicit exit checks immediately after `npm ci` and all build commands. Do not allow stale `node_modules` or `extension/dist` to mask a failed dependency/build step.

#### P2-06 — Certification environment is not immutable

**Affected:** workflows, lockfiles, companion checkout

- GitHub Actions use mutable major tags;
- Rust uses mutable `stable`;
- the desktop CI contract checks out a moving feature branch;
- certification uses Node 22 for `node:sqlite` while other jobs use Node 20;
- historical docs name versions that differ from the current lockfile.

Define a canonical certification environment, record resolved versions, and pin the cross-repo compatibility commit. Prefer immutable action SHAs/toolchain versions for release certification.

Current lockfile snapshot at audit time includes Playwright 1.62.1, TypeScript 5.9.3, Vite 5.4.21, ESLint 9.39.5, and rusqlite 0.32.1; do not hard-code these as eternal requirements—record what actually runs.

#### P2-07 — CI fixture mutates the runner's APPDATA CopyIt path

**Affected:** `tests/helpers/cert-fixture.mjs`

This is acceptable only on a known disposable hosted runner. Add an explicit ephemeral-certification guard or an isolated supported mechanism before allowing the same path on self-hosted/persistent machines. Destructive synthetic fixture creation must never target a real user's canonical DB.

#### P2-08 — Dependency/supply-chain state needs current executable evidence

Run an advisory/license/supply-chain review appropriate to npm and Cargo. Fix actionable vulnerabilities; document justified accepts. Do not opportunistically major-upgrade unrelated packages during certification.

### P3 / Low

#### P3-01 — Empty exported clipboard stub

`extension/src/clipboard.ts` exports `clearAfterDelay(): void {}`. No current call site establishes that timed clipboard clearing is a product requirement. Remove the dead API, or implement it only if a documented requirement and UX/security design justify it. Do not leave an unexplained placeholder.

#### P3-02 — Agent authority documents are stale

`AGENTS.md` and the old `.agent/EXECUTION_PROMPT.md` direct agents to re-execute the original V1 implementation plan. The original `IMPLEMENTATION_PLAN.md` is valuable historical design context but must not remain the primary current-work authority.

Update handoff docs so this campaign is authoritative for completion work.

#### P3-03 — Optional smoke scripts use success exit for skipped environments

`tests/real-browser-smoke.mjs` exits 0 when Edge is absent. That is acceptable only while explicitly optional. If promoted to a release gate, introduce explicit skip/NOT-RUN reporting or require the browser.

## 5. Target execution sequence

The following order is intentionally small and dependency-aware. Do not start broad cleanup before the P1s.

### Phase A — Baseline, evidence ledger, and authority cleanup

#### Objective
Establish a reproducible current-state baseline and prevent stale plans from driving work.

#### Required implementation
- record both repo SHAs and working-tree state;
- enumerate all tracked files and classify them;
- create/update an evidence ledger with command, environment, result, and artifact pointer;
- update `AGENTS.md` to make this campaign the current authority and mark `IMPLEMENTATION_PLAN.md` historical;
- inspect current GitHub Actions conclusions for the exact SHA where available.

#### Validation
Run the locally applicable baseline without changing code first:
- `npm ci`
- `npm run build`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npx playwright install chromium`
- `npm run e2e`
- `cargo fmt --manifest-path native-host/Cargo.toml -- --check`
- `cargo clippy --manifest-path native-host/Cargo.toml --all-targets --all-features -- -D warnings`
- `cargo test --manifest-path native-host/Cargo.toml --all-targets --all-features`

For the companion desktop, run its test/clippy baseline at the exact inspected/fixed commit.

#### Exit criteria
Every baseline failure is recorded as a finding. No current gate is inferred green from the old certification report.

### Phase B — P1 shared-data correctness

#### Objective
Close P1-01 before relying on browser/desktop compatibility.

#### Required implementation
Fix desktop empty reconciliation, add desktop regression coverage, then add or extend a browser/native-host compatibility check that proves clear-all is observed as an empty library.

#### Constraints
Do not change schema version, vault parameters, canonical DB location, or the host's read-only V1 protocol merely to fix this bug.

#### Acceptance
Clear-all in desktop => zero rows in SQLite => zero snippets from host/browser.

#### Exit criteria
P1-01 closed with executable evidence in both repositories.

### Phase C — P1 certification-integrity repair

#### Objective
Make every release gate truthful and fail closed.

#### Required implementation
Close P1-02, P1-03, P1-04 and P2-01 together:
- repair oversized-frame assertion;
- repair PowerShell subprocess exit handling;
- split/rename Chrome evidence honestly;
- attempt real Chrome Stable E2E without weakening security;
- if technically blocked, make the limitation explicit and require a separate manual Chrome acceptance record instead of automated PASS;
- update `docs/certification.md` only after the gates are correct.

#### Acceptance
No script reports PASS for a branch that was skipped, missing, killed by the test itself, or executed in a different browser than its label.

#### Exit criteria
Zero known false-green paths in required release certification.

### Phase D — Popup correctness, UX, and test-quality hardening

#### Objective
Close P2-02 through P2-04 and audit adjacent races/accessibility.

#### Required implementation
- replace the protected-copy retry selector with a stable pending-operation reference;
- prove exactly-once retry after unlock and correct success/reset feedback;
- surface lock failures without falsely changing lock state;
- test native disconnect/reconnect, clipboard denial, rapid search/category races, popup close during operations, and repeated copy clicks;
- verify dialog focus entry/return, Escape, keyboard navigation, ARIA announcements, long Unicode strings, zoom/narrow popup, and reduced-motion behavior;
- replace replica unit tests with production-path tests.

#### Acceptance
Every material popup defect found during this phase receives regression coverage.

#### Exit criteria
No known P1/P2 browser UX/correctness issue remains.

### Phase E — Installer, CI, dependency, and environment reproducibility

#### Objective
Make clean-checkout certification deterministic and non-destructive.

#### Required implementation
- close P2-05 through P2-08;
- make install/dev-install fail immediately on dependency/build failure;
- pin/record certification runtime versions;
- pin the desktop compatibility commit or replace branch drift with a contract fixture/gate;
- add safe CI fixture guardrails;
- audit workflow permissions, artifacts, cache behavior, quoting, and secret exposure;
- run current npm/Cargo advisory checks;
- ensure uninstall/reinstall is idempotent and user data survives.

#### Validation
Use a clean Windows checkout and a fresh profile. Exercise paths with spaces and non-ASCII where practical.

#### Exit criteria
Clean checkout -> dependencies -> build -> isolated install -> verify -> certification -> uninstall -> reinstall is repeatable without relying on stale machine state.

### Phase F — Storage/protocol/security fault injection

#### Objective
Harden already-strong boundaries rather than redesign them.

#### Required implementation
Add focused tests for:
- truncated/zero/oversized frames and abrupt EOF;
- invalid UTF-8/JSON, unknown methods, malformed IDs/params;
- response-size boundary;
- hostile search/category strings;
- migration-lock contention and stale temp files;
- corrupt legacy JSON and corrupt/newer SQLite;
- failed rename/permission/disk-like failures where simulatable;
- WAL concurrent reader/writer behavior;
- backup collision/failure behavior;
- logging/stdout redaction and protocol purity.

#### Constraints
Preserve the verified schema/vault/origin contracts.

#### Exit criteria
Malformed or unavailable inputs fail safely, deterministically, and without data loss/leakage.

### Phase G — Performance/accessibility/documentation hardening

#### Objective
Close remaining non-blocking quality risks with evidence.

#### Required implementation
- benchmark popup/native-host startup and list/search for representative small, ~1k, and ~10k libraries;
- inspect unnecessary DOM rebuilds, DB opens, allocations, logging, and KDF repetition;
- optimize only measured or structurally obvious waste;
- synchronize README, installation, troubleshooting, architecture, protocol, security, storage migration, agent docs, and certification;
- remove/resolve P3 dead/stale artifacts.

#### Exit criteria
Performance is appropriate for intended personal workloads and docs match executable reality.

## 6. Final release-certification matrix

Run from a clean checkout at the final SHAs. Record exact commands and results.

### Browser-extension repo
- `npm ci`
- `npm run build`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run e2e`
- `cargo fmt --manifest-path native-host/Cargo.toml -- --check`
- `cargo clippy --manifest-path native-host/Cargo.toml --all-targets --all-features -- -D warnings`
- `cargo test --manifest-path native-host/Cargo.toml --all-targets --all-features`
- release native-host build and `--self-test`
- repaired native subprocess certification
- repaired failure-state certification
- strict install verification for Chrome and Edge
- real Edge Stable E2E
- real Chrome Stable E2E **only if a real Chrome executable actually performs the flow**; otherwise record NOT-RUN/ENVIRONMENT-BLOCKED plus the explicit manual Chrome acceptance result
- uninstall/reinstall + registry cleanup + DB preservation
- storage/log/console/stdout secret-leak sanity
- repository cleanliness and generated-artifact check

### Companion desktop repo
- full unit/integration tests;
- clippy/fmt;
- empty-library reconciliation regression;
- schema/vault cross-contract tests;
- desktop-create/update/delete/clear -> host-read compatibility journey.

### Required Chrome manual acceptance when real automation is unavailable
On Chrome Stable with a fresh test profile:
1. load the exact final `extension/dist`;
2. verify deterministic extension ID;
3. open popup and confirm native host connectivity;
4. verify list, search, and category filter;
5. copy plaintext and compare exact clipboard content;
6. attempt protected copy while locked;
7. verify wrong password does not leak/copy protected body;
8. unlock with synthetic fixture password and verify exact protected clipboard;
9. relock and verify protected retrieval is blocked again;
10. inspect extension console, host log, browser storage, and registry/origin for obvious errors or sensitive leakage.

This manual gate is evidence, but it must remain labeled manual.

## 7. Autonomous-session operating rules

This campaign is suitable for a long autonomous session of up to roughly 12 hours, but time consumption is not a goal.

- Work P0 -> P1 -> P2 -> P3.
- Fix verified defects before speculative optimization.
- Run focused tests after each change cluster; run broad gates at phase boundaries.
- A failing required gate blocks progression until fixed or explicitly classified as environment-blocked.
- Never turn a skip, absent binary, timeout, manual kill, or substitute executable into PASS.
- Add regression coverage for every material defect.
- Keep verified and unverified claims separated in commits and docs.
- Serialize edits to shared schema, vault crypto, protocol, deterministic extension identity, and migration semantics.
- Parallelize only independent read-only audits or isolated tests.
- Do not broaden extension permissions or allowed origins to simplify testing.
- Do not touch real user data during destructive fixture tests.
- Do not stop after compilation or a single green suite.
- Once implementation defects are exhausted, continue through hardening, fault injection, release certification, and documentation synchronization.
- Stop when remaining work is genuinely low-value/speculative or explicitly outside V1.

## 8. Project-completion definition

The project may be called complete for V1 only when all of the following are true:

1. no open P0/P1 defect remains;
2. P1-01 clear-all synchronization is fixed and regression-tested;
3. no required certification gate has a known false-green path;
4. Chrome/Edge support claims exactly match the browser binaries and workflows actually tested;
5. all material discovered defects have regression coverage where feasible;
6. shared SQLite and vault contracts remain compatible across both repositories;
7. migration, unsupported/corrupt data, concurrency, and malformed protocol paths fail safely;
8. install/verify/uninstall/reinstall is reproducible from a clean checkout;
9. user data is preserved by uninstall and isolated from destructive certification;
10. popup core journeys and accessibility/failure states are validated;
11. current CI and release-certification evidence is green or explicitly NOT-RUN for a genuinely environment-limited manual gate;
12. documentation and agent handoffs reflect current reality rather than old completion claims;
13. no material placeholder, disabled critical test, debug bypass, leaked secret, or knowingly broken user-facing V1 behavior remains; and
14. any remaining work is documented, genuinely non-blocking, and not deferred merely because the session ended.

If these criteria are satisfied, stop rather than inventing another feature campaign.

## 9. Execution closure — 2026-08-31

The local remediation and certification pass is recorded in
`EVIDENCE_LEDGER_2026-08-28.md`. It verifies the P0/P1 findings, deterministic
build/test gates, native failure handling, cross-repository contract,
real-Edge/Chromium coverage, explicit Chrome automation/manual results,
isolated install lifecycle, security checks, and documentation updates.
The required post-push GitHub Actions conclusions are runtime-verified for
release candidate `2b8eaa1895076e03fce5ef53d1b2f23a960202e5`: CI
`33378008025`, Windows Integration `33378008040`, and Windows Certification
`33378008113` all concluded `success`. The campaign completion criteria are
satisfied; final classification: `V1 RELEASE-CERTIFIED`.
