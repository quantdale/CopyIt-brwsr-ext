#!/usr/bin/env node
/**
 * Real Google Chrome Stable functional certification.
 *
 * This command is deliberately strict: it runs the functional journey with
 * the installed Chrome executable and never substitutes Playwright's bundled
 * Chromium. If Chrome cannot load the unpacked extension in this environment,
 * the result is NOT-RUN / ENVIRONMENT-BLOCKED (non-zero), not a PASS.
 */
import { findChromeExecutable, readExecutableVersion, runRealBrowserCertification } from "./helpers/real-browser-e2e-helpers.mjs";
import { existsSync } from "node:fs";

const exe = findChromeExecutable();
if (!exe || !existsSync(exe)) {
  console.error("CHROME_STABLE_REAL_E2E: NOT-RUN / ENVIRONMENT-BLOCKED — Chrome Stable executable not found.");
  process.exit(2);
}

console.log(`Chrome Stable executable: ${exe}`);
console.log(`Chrome Stable version: ${readExecutableVersion(exe) ?? "unavailable (functional launch is still required)"}`);

try {
  await runRealBrowserCertification({ browserName: "Chrome Stable", executablePath: exe, exitOnFailure: false });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const environmentBlocked = /ERR_BLOCKED_BY_CLIENT|executable not found|browser launch|not ready|timeout/i.test(message);
  console.error(`CHROME_STABLE_REAL_E2E: ${environmentBlocked ? "NOT-RUN / ENVIRONMENT-BLOCKED" : "FAIL"}`);
  console.error(message);
  process.exit(environmentBlocked ? 2 : 1);
}
