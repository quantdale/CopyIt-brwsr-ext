#!/usr/bin/env node
/**
 * Verifies Chrome Stable presence and the deterministic extension identity.
 * This gate does not claim that Chrome executed the popup journey.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { findChromeExecutable, readExecutableVersion, EXPECTED_ID } from "./helpers/real-browser-e2e-helpers.mjs";

const manifestPath = resolve("extension/dist/manifest.json");
if (!existsSync(manifestPath)) {
  console.error("CHROME_INSTALL_ORIGIN_VERIFICATION: FAIL — extension/dist/manifest.json is missing; run npm run build.");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`CHROME_INSTALL_ORIGIN_VERIFICATION: FAIL — manifest is invalid: ${error.message}`);
  process.exit(1);
}
if (typeof manifest.key !== "string" || manifest.key.length === 0) {
  console.error("CHROME_INSTALL_ORIGIN_VERIFICATION: FAIL — manifest.key is missing.");
  process.exit(1);
}

const derived = spawnSync(process.execPath, ["scripts/get-extension-id.mjs", manifestPath], {
  encoding: "utf8",
});
if (derived.status !== 0) {
  console.error(`CHROME_INSTALL_ORIGIN_VERIFICATION: FAIL — extension ID derivation failed: ${derived.stderr.trim()}`);
  process.exit(1);
}
const actualId = derived.stdout.trim();
if (actualId !== EXPECTED_ID) {
  console.error(`CHROME_INSTALL_ORIGIN_VERIFICATION: FAIL — expected ${EXPECTED_ID}, derived ${actualId}.`);
  process.exit(1);
}

const chrome = findChromeExecutable();
if (!chrome || !existsSync(chrome)) {
  console.error("CHROME_INSTALL_ORIGIN_VERIFICATION: NOT-RUN / ENVIRONMENT-BLOCKED — Chrome Stable executable not found.");
  process.exit(2);
}

console.log("CHROME_INSTALL_ORIGIN_VERIFICATION: PASS");
console.log(`  executable: ${chrome}`);
console.log(`  version: ${readExecutableVersion(chrome) ?? "unavailable"}`);
console.log(`  extensionId: ${actualId}`);
console.log(`  origin: chrome-extension://${actualId}/`);
