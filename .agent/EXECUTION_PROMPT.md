# Autonomous Execution Prompt — CopyIt V1 Completion

Execute the current completion campaign for `quantdale/CopyIt-brwsr-ext` and the companion `quantdale/CopyIt` repository where the shared SQLite contract requires a coordinated fix.

## Authority

Primary current-work authority:

`docs/implementation/NEXT_CAMPAIGN_2026-08-28.md`

Read it in full before editing.

`IMPLEMENTATION_PLAN.md` is historical design context for the original V1 build. Preserve still-valid product invariants from it, but do **not** restart or re-implement completed V1 work simply because old checklist items remain unchecked.

Inspect code and executable evidence over documentation claims. Existing `docs/certification.md` is historical evidence and contains known overstatements that the campaign explicitly requires you to correct.

## Goal

Drive CopyIt Browser Extension V1 to defensible functional completeness and production readiness by closing verified blockers first, then hardening and recertifying.

The immediate priority order is:

1. fix the companion desktop empty-library SQLite reconciliation bug;
2. eliminate false-green/mislabeled certification paths, especially "Real Chrome E2E" and oversized-frame certification;
3. repair popup protected-copy retry/lock UX and replace hollow tests;
4. make installer/CI/dependency/cross-repo certification reproducible;
5. perform protocol/migration/security/accessibility/performance hardening;
6. run final release certification and synchronize documentation.

## Required execution behavior

- Pull latest state and record exact SHAs for both repositories.
- Keep VERIFIED, HISTORICAL, RUNTIME-VERIFIED, FAILED, and NOT-RUN evidence separate.
- Run baseline tests before changing behavior.
- Work severity-first and dependency-first.
- Add regression tests with every material fix.
- After each meaningful cluster, run focused validation and immediately repair regressions.
- Do not report PASS for a skipped test, missing browser, substitute browser, timeout, manually killed process, or unexecuted workflow.
- A real Chrome E2E claim requires a real Chrome executable to perform the tested journey. Bundled Chromium is useful evidence but must be labeled Chromium.
- Do not weaken allowed origins, browser security, vault crypto, migration safety, or extension permissions to make automation easier.
- Do not let destructive certification touch real user CopyIt data.
- Coordinate shared-contract edits across repositories; schema/vault/protocol changes require explicit compatibility proof.
- Commit coherent verified change clusters and push progress so another agent can resume from the repository.
- Continue after implementation into hardening and final certification; do not stop because one suite compiles or passes.

## Long-session behavior

Work productively for up to roughly 12 hours if useful. Do not pad the session. When P0/P1 work is exhausted, continue through P2 hardening, fault injection, accessibility, installer resilience, dependency/workflow hygiene, performance sanity, documentation synchronization, and release certification.

If a required environment-dependent gate genuinely cannot run, document exact cause and mark it NOT-RUN / ENVIRONMENT-BLOCKED. Continue all independent work; do not fabricate success.

## Completion standard

Do not declare V1 complete until every completion criterion and final certification gate in `docs/implementation/NEXT_CAMPAIGN_2026-08-28.md` is satisfied or a genuinely non-blocking limitation is explicitly documented with truthful evidence.

At the end, update the certification/evidence documents with:
- start and final SHAs for both repositories;
- exact commands and environment/tool/browser versions;
- PASS / FAIL / NOT-RUN results;
- defects fixed and regression tests added;
- data-safety/security evidence;
- current Chrome and Edge evidence without equivalence overclaim;
- remaining limitations, if any;
- final release decision justified by evidence.
