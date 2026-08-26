# CopyIt Browser Extension — Agent Guide

## Primary instruction

Read **`IMPLEMENTATION_PLAN.md` in full before making implementation changes**.

That document is the approved product, architecture, migration, security, testing, installation, and delivery specification for this repository and its coordinated changes in `quantdale/CopyIt`.

Do not replace it with a smaller ad-hoc plan.

## Execution expectation

When asked to implement the browser extension, execute the complete vertical slice in one campaign:

1. establish baselines in this repository and `quantdale/CopyIt`;
2. create coordinated feature branches from latest `main`;
3. implement the shared SQLite data contract and safe legacy JSON migration;
4. migrate the desktop CopyIt persistence layer without weakening existing data-safety/vault behavior;
5. implement the Rust Chromium Native Messaging host;
6. implement the Manifest V3 Chrome/Edge popup;
7. implement title-only compact rows, copy action, search/category filtering, description tooltips, and protected-prompt unlock;
8. implement deterministic extension ID + per-user Chrome/Edge native-host registration scripts;
9. add unit, integration, Playwright, migration, vault compatibility, and existing desktop simulation validation;
10. add CI and user/developer documentation;
11. run all applicable gates, fix deterministic failures and Critical/High defects;
12. commit and push both coordinated branches and provide the final certification report required by the plan.

Do not stop merely because one phase is complete. Do not ask for routine architecture choices already resolved by `IMPLEMENTATION_PLAN.md`.

## Repository boundary

This repository owns:

- browser extension;
- native messaging host;
- native protocol;
- Chrome/Edge registration/install tooling;
- extension/native-host tests and docs.

The companion `quantdale/CopyIt` repository owns the desktop application and must be updated to use the same canonical SQLite database. If it is not already present as a sibling workspace, clone it as a sibling; do not nest its Git repository inside this repo.

## Non-negotiable invariants

- One canonical library: `%APPDATA%\CopyIt\copyit.db`.
- No live JSON/SQLite dual-write synchronization.
- Legacy JSON migration must be verified, idempotent, recoverable, and preserve corrupt-source behavior.
- Protected snippet cryptography must stay compatible with existing CopyIt.
- No prompt bodies/passwords/keys in logs or browser storage.
- V1 browser surface is read/search/copy/unlock only.
- V1 does not inject into websites and must not request broad host/site permissions.
- Description is optional and tooltip-only in the extension list.
- Native host stdout is protocol-only.
- Existing desktop tests/simulations remain part of the release gate.

## Quality policy

Prefer correctness and data safety over cleverness. Keep modules small, use typed errors and bound SQL parameters, preserve minimal browser permissions, and prove migration/vault compatibility with deterministic fixtures.

A feature is not complete because it compiles. Complete means the acceptance criteria and validation matrix in `IMPLEMENTATION_PLAN.md` have been satisfied or an environment-specific gate is explicitly reported as unavailable with evidence.
