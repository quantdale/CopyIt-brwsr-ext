# CopyIt Browser Extension — Post-Certification Audit & Hardening Campaign

**Date:** 2026-08-28  
**Repository:** `quantdale/CopyIt-brwsr-ext`  
**Baseline:** `main` at `12e457fb4c67e54e534b5aae9fb2f338994c4d83`  
**Campaign type:** Codebase hardening + certification closure, with implementation only where audit evidence requires it

## Executive decision

The repository is no longer in an initial implementation state. The audited tree contains the extension UI, Rust native host, SQLite/migration/vault/protocol layers, Windows installation lifecycle, Chrome/Edge integration harnesses, CI workflows, tests, and extensive certification documentation. Recent history is dominated by certification/CI fixes rather than missing product scaffolding.

Therefore the correct next phase is **hardening and evidence closure**, not another broad feature campaign. Do not manufacture features. Preserve the V1 product contract (read/search/copy/unlock, minimal permissions, one canonical CopyIt database) unless a verified defect requires a compatible change.

The most important unresolved certification risk is that the existing report labels Chrome production readiness as READY while its automated functional proof is primarily bundled Chromium plus real-Chrome installation/version/manual evidence. That is useful evidence, but it is not equivalent to a fully automated real Chrome Stable end-to-end run. The next campaign must make claims match evidence and, where technically possible, close that gap.

## Audit methodology for the executing agent

This document is a handoff specification, not permission to trust existing completion claims. Before modifying code, independently re-audit the entire repository at the pulled SHA.

1. Enumerate every tracked file and classify it as product code, tests, build/config, installer, CI, docs, generated fixture/artifact, or agent metadata.
2. Read all source and scripts, including `extension/`, `native-host/`, `protocol/`, `scripts/`, `tests/`, `.github/workflows/`, root configuration, `AGENTS.md`, `.agent/`, README, implementation plan, and certification/security/architecture docs.
3. Trace end-to-end workflows: install -> registry/manifest -> browser launch -> native messaging -> DB open/migration -> list/search -> plaintext copy -> protected unlock/copy -> relock -> uninstall/reinstall.
4. Search for TODO/FIXME/HACK, stubs, skipped/disabled tests, environment bypasses, debug-only behavior, duplicated constants/contracts, stale paths, weak assertions, misleading certification language, and silent error swallowing.
5. Cross-check every material README/certification/implementation-plan claim against executable code and current tests.
6. Re-run all locally applicable gates. Record commands, exit codes, failures, skips, environment constraints, and remediation.
7. Treat companion-repository compatibility with `quantdale/CopyIt` as an external contract: verify schema/crypto/protocol assumptions against the current desktop implementation where access is available. Do not silently fork the contract.

## Severity-ranked remediation map

### P0 — release blockers

No P0 is asserted solely from the repository snapshot reviewed during planning. The executing agent must promote any discovered data-loss, vault-secret leakage, origin-validation bypass, unsafe migration, native-framing memory exhaustion, or unusable install path immediately to P0 and stop lower-priority work until fixed and regression-tested.

### P1 — high

#### H1. Real Chrome Stable certification truth gap

**Affected:** `tests/real-chrome-e2e.mjs`, `.github/workflows/windows-certification.yml`, installer/verification scripts, `docs/certification.md`, README release claims.

**Observed:** existing certification states READY and calls the Chrome path certified, but describes the functional automation as bundled Chromium because Chrome Stable automation was blocked. Engine equivalence is valuable but is not literal real-Chrome E2E evidence.

**Required remediation:**
- Attempt a deterministic real Chrome Stable extension E2E using a fresh profile and supported launch/attachment technique available on the certification host.
- Do not weaken browser security globally or require unsafe end-user flags merely to make a test pass.
- If real Chrome automation remains technically blocked, preserve Chromium + Edge automation but rename the gate and release claims precisely: real Chrome install/origin/manual-smoke evidence plus Chromium functional-equivalence evidence. Do not call it a 35/35 real-Chrome automated E2E.
- Add a documented, short manual Chrome Stable acceptance checklist that validates toolbar load, list/search, plaintext clipboard, native-host connectivity, protected unlock/copy, relock, and absence of obvious console errors.
- If a reliable real-Chrome automated path is found, make it a Windows certification gate and archive enough diagnostics to debug failures.

**Verification:** fresh Windows user-data dir; deterministic extension ID; actual `chrome.exe` process; extension page/action reachable; native host invoked by Chrome; plaintext and protected clipboard exact-match; wrong password does not leak; logs/storage checked.

**Acceptance:** either true automated Chrome Stable E2E passes, or all documentation and CI labels accurately disclose the remaining automation limitation while a reproducible manual Chrome gate passes.

#### H2. Certification reproducibility and evidence provenance

**Affected:** `.github/workflows/*`, `docs/certification.md`, `scripts/*`, test harnesses.

**Required remediation:** ensure certification can be reproduced from a clean checkout without depending on undeclared machine state. Pin/validate required Node/Rust/Playwright inputs, make fixture setup deterministic, ensure registry/install cleanup is idempotent, and archive/report machine/browser/tool versions and gate results. Separate tests that use the user's canonical `%APPDATA%\CopyIt` data from tests that must use an isolated fixture; destructive certification must never mutate real user data.

**Acceptance:** clean checkout -> dependency install -> build -> isolated install/certification -> uninstall succeeds repeatedly; no test writes or migrates the real user's DB unless an explicitly named non-destructive compatibility check requires read-only access.

### P2 — medium

#### H3. Cross-repository SQLite and vault compatibility drift

Audit `db.rs`, `migration.rs`, `legacy.rs`, `vault.rs`, protocol test vectors, schema docs, and the current desktop `CopyIt` implementation. Centralize or mechanically test duplicated constants/semantics where practical: schema version, Argon2 parameters, XChaCha format, base64 representation, protected-row invariants, category normalization, timestamps, busy timeout/WAL behavior, unsupported-future-schema handling.

Add bidirectional compatibility fixtures/tests: DB created/migrated by desktop readable by host; protected row produced by desktop decryptable by host; browser-side reads never mutate snippet data; newer unsupported schema fails closed with an actionable error.

#### H4. Native messaging boundary hardening

Fuzz/property-test framing and protocol parsing within practical limits: truncated prefixes, zero length, oversized length, invalid UTF-8/JSON, unknown methods, duplicate/invalid IDs, malformed params, abrupt EOF, stdout contamination, repeated requests, and hostile search/category strings. Bound request/response sizes before allocation and serialization. Ensure all logs go to stderr/file and redact bodies/passwords/derived keys/ciphertext where appropriate.

#### H5. Migration and concurrent-access fault injection

Exercise migration lock contention, corrupt JSON, corrupt DB, partial temp DB, failed rename, stale lock, disk/permission failures where simulatable, duplicate/odd IDs, Unicode, huge descriptions, empty categories, WAL readers/writers, and desktop/native-host concurrent access. Migration must be atomic, idempotent, preserve source/backups, never reinterpret corruption as missing, and never silently initialize over damaged data.

#### H6. Extension lifecycle, race, and accessibility review

Audit popup request sequencing, debounce/stale-response handling, rapid category/search changes, popup close during request/unlock, repeated copy clicks, clipboard denial, native disconnect/reconnect, empty/error/loading states, tooltip keyboard behavior, focus trapping/restoration in unlock UI, Escape behavior, ARIA names/status announcements, high zoom, narrow popup, long Unicode titles/descriptions, reduced motion, and contrast. Add regression tests for every material defect.

#### H7. Installer/uninstaller robustness

Test paths containing spaces/non-ASCII, repeated install, upgrade over older host, missing browser, one-browser-only install/verify modes, stale registry values, moved checkout, locked executable, uninstall after partial install, and preservation of canonical DB/backups. Registry and host-manifest origin must be exact; do not broaden allowed origins.

#### H8. Dependency, CI, and supply-chain hygiene

Audit npm/Cargo dependency versions, lockfiles, advisories, build scripts, GitHub Actions permissions, artifact contents, cache keys, shell quoting, and secret exposure. Use least-privilege workflow permissions. Do not perform opportunistic major upgrades unless required; fix actionable vulnerabilities and add rationale for accepted non-exploitable advisories.

### P3 — low

#### H9. Documentation and repository cleanup

Synchronize README, architecture, protocol, storage migration, installation, troubleshooting, security, implementation plan, agent prompt, and certification wording with the final code. Remove obsolete completion claims, stale commands, dead fixtures, accidental generated outputs, and duplicated documentation where it causes drift. Preserve historical reports but clearly mark superseded evidence.

#### H10. Performance sanity

Measure popup startup/list/search latency and native-host cold start against representative libraries (small, 1k, 10k snippets where practical). Look for unnecessary DOM rebuilds, unbounded result sets, redundant DB opens/queries, repeated KDF work, excessive allocations, and logging overhead. Optimize only measured or structurally obvious waste; preserve security and correctness.

## Execution phases

### Phase A — baseline and evidence ledger

Create an audit ledger mapping every tracked file to review status and every release claim to evidence. Capture baseline SHA, dependency versions, test inventory, workflow inventory, and current skip list. Run the existing validation stack before changes. Any failure becomes a finding rather than being waived.

**Exit:** complete file inventory; no unreviewed product/test/config file; baseline results recorded; P0/P1 findings identified.

### Phase B — P0/P1 closure

Fix all discovered P0s. Then resolve H1 and H2. Certification wording must never outrun evidence. Prefer real Chrome Stable automation if it can be made reliable without compromising the product/security model.

**Exit:** zero open P0/P1; Chrome support claim is technically precise and reproducible.

### Phase C — protocol/storage/security hardening

Execute H3-H5. Add regression/fault-injection tests before or with fixes. Preserve compatibility with the desktop CopyIt database and vault cryptography.

**Exit:** malformed input fails safely; migration/concurrency invariants tested; cross-repo compatibility has executable evidence.

### Phase D — UX/platform/install hardening

Execute H6-H7. Validate both Chrome and Edge installation paths and popup behavior, including failure states and accessibility.

**Exit:** core user journeys work from fresh install through uninstall/reinstall; accessibility/failure-path defects of material severity are closed.

### Phase E — CI/dependencies/performance/docs

Execute H8-H10. Keep changes evidence-driven. Update documentation only after behavior and gates stabilize.

**Exit:** no actionable high-severity dependency/workflow issue; performance is acceptable for intended personal-use workloads; docs match reality.

### Phase F — release certification

From a clean checkout, run the strongest applicable matrix:

- `npm ci`
- TypeScript typecheck
- ESLint
- extension unit/DOM tests
- extension production build
- Playwright popup E2E
- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --all-targets --all-features`
- native-host release build and self-test
- protocol/failure-state tests
- installer + strict verification for Chrome and Edge
- isolated deterministic native-host integration
- real Edge Stable E2E
- real Chrome Stable E2E if reliable; otherwise explicit manual Chrome Stable acceptance + clearly named Chromium equivalence suite
- uninstall/reinstall and DB-preservation check
- security sanity: no secrets/body leakage to storage, DOM before copy, stdout, console, CI logs, or artifacts
- documentation/command consistency check
- repository cleanliness check

Do not accept a green test count if important tests are skipped or do not test the claimed browser/path.

## Long autonomous-session policy

This campaign is designed for an agent to continue productively for up to roughly 12 hours, not to consume time artificially. Work severity-first and dependency-first. After each meaningful cluster, run focused validation. Repair regressions immediately. Do not stop after one successful fix. When implementation defects are exhausted, continue into fault injection, security, accessibility, installer resilience, performance sanity, documentation synchronization, and final certification.

The agent may parallelize independent read-only audits and isolated test research, but must serialize edits that touch shared contracts such as schema, vault crypto, protocol, installer identity/origin, and certification documentation. Do not allow parallel agents to independently redefine those contracts.

## Completion definition

The campaign is complete only when:

1. every tracked repository area has been audited;
2. no open P0/P1 defect remains;
3. all material discovered defects have regression coverage where feasible;
4. browser/native-host/storage/vault/install workflows are validated end-to-end;
5. migration and protected data are demonstrably safe under tested failure conditions;
6. Chrome and Edge support claims exactly match the evidence obtained;
7. CI/build/install/uninstall paths are reproducible from a clean checkout;
8. documentation reflects the final implementation and limitations;
9. there are no knowingly broken user-facing V1 behaviors, placeholders, disabled critical tests, leaked secrets, or accidental debug bypasses; and
10. remaining work is explicitly documented, genuinely non-blocking, and not merely deferred because the session is ending.

If all of these conditions are already satisfied after independent re-verification, do not invent another feature campaign. Produce a concise final audit/certification update and stop.