# CopyIt Browser Extension — Agent Guide

## Primary instruction

For current work, read **`docs/implementation/NEXT_CAMPAIGN_2026-08-28.md` in full before making changes**.

That file is the authoritative completion/hardening campaign for this repository and coordinated work in `quantdale/CopyIt`.

`IMPLEMENTATION_PLAN.md` remains historical V1 design context. Use it to preserve product, architecture, migration, security, and UX invariants, but do **not** restart already completed implementation work or treat old unchecked checklist items as proof that a feature is missing.

`.agent/EXECUTION_PROMPT.md` is the concise autonomous-execution handoff and points to the same campaign.

When documentation conflicts with current code or executable evidence, investigate and record the discrepancy. Do not manufacture a PASS or a missing feature from stale documentation.

## Current execution priority

The current campaign is **combined implementation + hardening, hardening-dominant**.

Work in this order:

1. establish exact baselines/evidence for this repository and companion `quantdale/CopyIt`;
2. close all P0/P1 findings in the current campaign, including the verified desktop empty-library SQLite reconciliation defect;
3. eliminate false-green and mislabeled certification paths, especially real-Chrome claims and failure-state tests;
4. close popup correctness/UX and weak-test findings;
5. make install/CI/dependency/cross-repo certification reproducible and non-destructive;
6. perform protocol, migration, security, accessibility, and performance hardening;
7. run the final release-certification matrix;
8. synchronize documentation and final release evidence.

Do not stop because one phase compiles or one suite passes. Do not invent new features merely to extend the campaign.

## Repository boundary

This repository owns:

- browser extension;
- native messaging host;
- native protocol;
- Chrome/Edge registration/install tooling;
- extension/native-host tests, CI, certification, and docs.

The companion `quantdale/CopyIt` repository owns the desktop application and writes the same canonical SQLite library. Coordinated fixes are required when a defect crosses that boundary. Keep repositories separate; do not nest one Git repository inside the other.

## Non-negotiable invariants

- One canonical library: `%APPDATA%\CopyIt\copyit.db`.
- No live JSON/SQLite dual-write synchronization.
- Legacy JSON migration must remain verified, idempotent, recoverable, and corruption-safe.
- Protected snippet cryptography must remain compatible with desktop CopyIt.
- Shared schema/vault/protocol changes require explicit cross-repository compatibility evidence.
- No prompt bodies, vault passwords, derived keys, or protected plaintext in browser storage, logs, CI artifacts, or protocol diagnostics.
- V1 browser surface remains read/search/filter/copy/unlock/lock only.
- V1 does not inject into websites and must not request broad host/site permissions.
- Description remains optional and tooltip-only in the compact extension list.
- Native host stdout is protocol-only.
- Deterministic extension identity and exact allowed-origin binding must not be weakened for testing.
- Destructive certification must not touch real user CopyIt data.
- Existing desktop tests/simulations remain part of the release gate.

## Evidence policy

Use explicit evidence states:

- **VERIFIED-CODE / VERIFIED-CROSS-REPO** for facts established directly from source;
- **RUNTIME-VERIFIED** for gates rerun at the current SHA;
- **HISTORICAL-EVIDENCE** for prior reports that were not rerun;
- **FAILED** for executed failing gates;
- **NOT-RUN / ENVIRONMENT-BLOCKED** for unavailable gates.

A skip, absent browser, substitute browser, timeout, manually killed process, or unexecuted workflow is never PASS.

A "real Chrome E2E" claim requires a real Chrome executable to execute the actual journey. Bundled Chromium may be useful compatibility evidence but must be labeled Chromium.

## Quality policy

Prefer correctness, data safety, and truthful evidence over cleverness or completion percentages. Keep modules small, use typed errors and bound SQL parameters, preserve minimal browser permissions, and prove migration/vault/storage compatibility with deterministic fixtures.

For every material defect:
1. reproduce or establish it with evidence;
2. fix the root cause;
3. add regression coverage where feasible;
4. run focused validation;
5. record any remaining limitation without upgrading it to PASS.

Project completion is defined by the acceptance and final-certification criteria in `docs/implementation/NEXT_CAMPAIGN_2026-08-28.md`, not by compilation or historical READY claims.
