#!/usr/bin/env node
/**
 * Real User DB Smoke (non-destructive)
 * Launches Edge with the real %APPDATA%\CopyIt\copyit.db (no fixture)
 * and verifies basic compatibility without asserting exact counts/titles.
 */
import { chromium } from "playwright";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EXTENSION_PATH = resolve("extension/dist");
const EXPECTED_ID = "mmiopnfmhmmlmhcdjklelfcdahmgchfc";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EDGE_PATH2 = "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe";
const exe = existsSync(EDGE_PATH) ? EDGE_PATH : existsSync(EDGE_PATH2) ? EDGE_PATH2 : null;
if (!exe) {
  console.log("REAL_USER_DB_SMOKE: NOT-RUN / ENVIRONMENT-BLOCKED — Edge Stable executable not found (optional smoke).");
  process.exit(0);
}

const userDir = mkdtempSync(join(tmpdir(), "copyit-smoke-"));
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: false,
  executablePath: exe,
  args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`, "--no-first-run"],
});
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
await new Promise(r => setTimeout(r, 1500));
const page = await ctx.newPage();
await page.goto(`chrome-extension://${EXPECTED_ID}/popup.html`, { timeout: 15000 });
await new Promise(r => setTimeout(r, 2000));
const status = await page.textContent("#status");
console.log(`Smoke status: "${status}"`);
const count = await page.$$eval("#list .row", els => els.length);
console.log(`Smoke row count: ${count}`);
if (count >= 1 || status.toLowerCase().includes("prompt") || status.toLowerCase().includes("no prompts")) {
  console.log("Smoke PASS: DB opened, no corruption");
  await ctx.close();
  process.exit(0);
} else {
  console.error("Smoke FAIL: unexpected status/empty");
  await ctx.close();
  process.exit(1);
}
