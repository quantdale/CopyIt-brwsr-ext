# One-Shot Execution Prompt — CopyIt Browser Extension V1

Execute the complete approved CopyIt browser-extension implementation in this repository and the companion `quantdale/CopyIt` desktop repository.

## Authority

`IMPLEMENTATION_PLAN.md` is the source of truth. Read it in full before editing code. `AGENTS.md` defines the execution contract. Do not substitute a smaller plan or stop after scaffolding.

## Goal

Deliver the complete V1 vertical slice so the user can pin CopyIt in Chrome/Edge, open a compact title-only prompt picker, search/filter prompts, hover/focus a row to see its optional description tooltip, click Copy to place the full prompt body on the clipboard, and unlock protected prompts for the lifetime of the popup/native-host session.

Both the browser extension and desktop CopyIt must use one canonical SQLite store at `%APPDATA%\CopyIt\copyit.db`, with a safe verified migration from the current JSON files. There must be no second browser prompt library and no live JSON/SQLite synchronization layer.

## Required campaign behavior

1. Pull latest state and record baseline SHAs for both repos.
2. Run and record desktop baseline tests before changing persistence.
3. Create coordinated feature branches from latest `main`.
4. Implement every applicable phase in `IMPLEMENTATION_PLAN.md` continuously.
5. Make routine reversible engineering decisions autonomously.
6. Preserve existing desktop data-safety, corruption handling, vault crypto, and simulation behavior.
7. Use minimal extension permissions; do not add site injection/content scripts in V1.
8. Build the Rust native messaging host, SQLite migration/storage contract, TypeScript MV3 extension, protected unlock flow, installer/registry tooling, CI, tests, and docs.
9. Exercise deterministic migration and vault compatibility fixtures before touching any real user data.
10. Run all stated quality gates and fix deterministic failures, Critical/High defects, warnings-as-errors failures, migration defects, and security regressions before declaring completion.
11. Commit and push both coordinated branches.
12. If authorized, open coordinated PRs; do not auto-merge unless explicitly requested.
13. Produce the final certification report specified in the plan with exact commands and PASS/FAIL results, start/final SHAs, data-safety evidence, and any genuinely unvalidated environment-specific items.

## Do not stop for

- naming of internal helpers;
- choice between equivalent small test utilities;
- routine refactors required by the approved architecture;
- ordinary compile/test failures that can be debugged;
- the fact that implementation spans two repositories.

If a material assumption is impossible, gather concrete evidence, choose the closest safe design preserving the approved goals, document the deviation, and continue as far as possible.

## Completion standard

Do not report success until the Definition of Success and acceptance checklist in `IMPLEMENTATION_PLAN.md` are satisfied to the extent the execution environment can actually validate them.
