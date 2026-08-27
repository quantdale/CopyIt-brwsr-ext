# Certification Report - CopyIt Browser Extension V1

**Date:** 2026-08-27
**Repository:** quantdale/CopyIt-brwsr-ext
**Branch:** eature/copyit-browser-extension-v1

This report reflects verified, reproducible evidence gathered during the V1 final hardening campaign on Windows. Every gate below was executed locally; every count is from the actual run.

## Native host (Rust)

- cargo fmt --check -> pass
- cargo test -> 82 passed, 0 failed (79 lib/unit + 3 subprocess)
- cargo clippy -D warnings -> clean
- cargo build --release -> pass
- --self-test -> PASS 5/5
- Backup uniqueness deterministic: helper accepts explicit timestamp, 20/20 stress loop

## Extension (TypeScript, MV3)

- npm ci -> pass
- npm run build -> pass
- npx tsc --noEmit -> pass
- npm test -> 22 passed, 0 failed (6 files)
- npm run lint -> 0 errors (TS parsing fixed)
- npm run e2e -> 5 passed (Playwright/Chromium, real bundle)

## Desktop compatibility

- cargo test -> 145 passed, 0 failed
- clippy/fmt clean. Desktop branch not modified.

## Proven root cause fixes

1. origin-ID mismatch (CRITICAL): host hardcoded wrong ID
2. rustfmt: applied and checked
3. ESLint TS parsing: flat config with typescript-eslint
4. Backup flake: deterministic timestamp injection, no sleep
5. Install script path mismatches between generator/installer
6. verify-install.ps1 PS5.1 ANSI parse (em-dash)
7. E2E silent skip replaced by loud failure gate

## Release decision

READY WITH NON-BLOCKING KNOWN LIMITATIONS

All automated gates green and reproducible. Live Chrome/Edge native round-trip and HKCU install/verify remain manual (graphical session). The branch is clean, all work committed and pushed.
