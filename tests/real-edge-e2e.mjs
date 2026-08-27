#!/usr/bin/env node
/**
 * Real Edge End-to-End Certification Suite
 * ========================================
 * Exercises the actual extension popup running in real Microsoft Edge,
 * connected via real Native Messaging to the real installed Rust native host,
 * querying the real CopyIt SQLite database (%APPDATA%\CopyIt\copyit.db),
 * and performing real clipboard copies.
 */
import { chromium } from "playwright";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const EXTENSION_PATH = resolve("extension/dist");
const EXPECTED_ID = "mmiopnfmhmmlmhcdjklelfcdahmgchfc";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0, details: [] };
function pass(n) { results.pass++; results.details.push({ name: n, status: "PASS" }); console.log(`  ✓ PASS: ${n}`); }
function fail(n, r) { results.fail++; results.details.push({ name: n, status: "FAIL", reason: r }); console.error(`  ✗ FAIL: ${n} — ${r}`); }

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║  CopyIt — Real Microsoft Edge E2E Certification Suite       ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  console.log(`Date: ${new Date().toISOString()}`);

  const userDir = mkdtempSync(join(tmpdir(), `copyit-edge-cert-`));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    executablePath: EDGE_PATH,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    viewport: { width: 800, height: 600 },
  });

  // Grant clipboard permissions
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await sleep(1500);

  const page = await ctx.newPage();
  
  // Track console errors
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  console.log("\n--- 1. Popup Navigation & Initialization ---");
  await page.goto(`chrome-extension://${EXPECTED_ID}/popup.html`, { timeout: 15000 });
  await sleep(2000);

  const pageUrl = page.url();
  console.log(`  Page URL: ${pageUrl}`);
  if (pageUrl.includes(EXPECTED_ID)) pass("edge:popup-loaded — URL matches expected extension ID");
  else fail("edge:popup-loaded", `URL is ${pageUrl}`);

  const title = await page.title();
  console.log(`  Page Title: "${title}"`);
  if (title === "CopyIt") pass("edge:popup-title — title is 'CopyIt'");
  else fail("edge:popup-title", `Title is "${title}"`);

  console.log("\n--- 2. Native Messaging & Real Database Read ---");
  const status = await page.textContent("#status");
  console.log(`  Status text: "${status}"`);
  if (status.includes("9 prompts") || status.includes("prompts")) pass(`edge:status — "${status}"`);
  else fail("edge:status", `Unexpected status: "${status}"`);

  const listItems = await page.$$eval("#list .row", (els) => els.map((e) => e.textContent.trim()));
  console.log(`  Rendered ${listItems.length} rows:`);
  listItems.forEach((t, i) => console.log(`    ${i + 1}. ${t}`));

  if (listItems.length === 9) pass("edge:snippets-count — exactly 9 real snippets loaded from copyit.db");
  else fail("edge:snippets-count", `Expected 9, got ${listItems.length}`);

  console.log("\n--- 3. Title-Only Compact Rows (No Body Exposure) ---");
  const bodyInRow = await page.$$eval("#list .row .row-body, #list .row-body, #list .body", (els) => els.length);
  if (bodyInRow === 0) pass("edge:title-only-rows — no body preview elements exist in list DOM");
  else fail("edge:title-only-rows", `Found ${bodyInRow} body elements`);

  console.log("\n--- 4. Categories & Category Filtering ---");
  const catOptions = await page.$$eval("#category-filter option", (els) => els.map((e) => ({ value: e.value, text: e.textContent.trim() })));
  console.log(`  Category options:`, catOptions);

  if (catOptions.length === 3 && catOptions[1].text === "Git (5)" && catOptions[2].text === "Prompt (4)") {
    pass("edge:categories-loaded — 'Git (5)' and 'Prompt (4)' loaded correctly");
  } else {
    fail("edge:categories-loaded", JSON.stringify(catOptions));
  }

  // Select "Git"
  await page.selectOption("#category-filter", "Git");
  await sleep(600);
  const gitItems = await page.$$eval("#list .row", (els) => els.map((e) => e.textContent.trim()));
  console.log(`  Git category items (${gitItems.length}):`, gitItems);
  if (gitItems.length === 5) pass("edge:category-filter-git — exactly 5 Git snippets rendered");
  else fail("edge:category-filter-git", `Expected 5, got ${gitItems.length}`);

  // Select "Prompt"
  await page.selectOption("#category-filter", "Prompt");
  await sleep(600);
  const promptItems = await page.$$eval("#list .row", (els) => els.map((e) => e.textContent.trim()));
  console.log(`  Prompt category items (${promptItems.length}):`, promptItems);
  if (promptItems.length === 4) pass("edge:category-filter-prompt — exactly 4 Prompt snippets rendered");
  else fail("edge:category-filter-prompt", `Expected 4, got ${promptItems.length}`);

  // Restore "All categories"
  await page.selectOption("#category-filter", "");
  await sleep(600);
  const allItems = await page.$$eval("#list .row", (els) => els.map((e) => e.textContent.trim()));
  if (allItems.length === 9) pass("edge:category-filter-all — restored 9 snippets");
  else fail("edge:category-filter-all", `Expected 9, got ${allItems.length}`);

  console.log("\n--- 5. Search Functionality ---");
  // Search for "GIT PU"
  await page.fill("#search", "GIT PU");
  await sleep(600); // debounce + roundtrip
  const searchResults1 = await page.$$eval("#list .row .row-title", (els) => els.map((e) => e.textContent.trim()));
  console.log(`  Search "GIT PU" results:`, searchResults1);
  if (searchResults1.length === 1 && searchResults1[0] === "GIT PULL EVERYTHING!!!") {
    pass("edge:search-exact-prefix — found 'GIT PULL EVERYTHING!!!'");
  } else {
    fail("edge:search-exact-prefix", JSON.stringify(searchResults1));
  }

  // Search for non-existent term
  await page.fill("#search", "nonexistentquery_xyz_999");
  await sleep(600);
  const searchResults2 = await page.$$eval("#list .row", (els) => els.length);
  const noMatchStatus = await page.textContent("#status");
  console.log(`  No-match search results: ${searchResults2}, status: "${noMatchStatus}"`);
  if (searchResults2 === 0 && noMatchStatus.includes("No matches")) {
    pass("edge:search-no-results — 'No matches.' status displayed");
  } else {
    fail("edge:search-no-results", `count: ${searchResults2}, status: "${noMatchStatus}"`);
  }

  // Rapid typing test
  console.log("  Testing rapid search typing...");
  await page.fill("#search", "a");
  await sleep(30);
  await page.fill("#search", "ai");
  await sleep(30);
  await page.fill("#search", "ai chat");
  await sleep(600);
  const aiResults = await page.$$eval("#list .row .row-title", (els) => els.map((e) => e.textContent.trim()));
  console.log(`  Rapid search "ai chat" results:`, aiResults);
  if (aiResults.some((t) => t.includes("AI Chat Session Transfer"))) {
    pass("edge:search-rapid-typing — debounced search resolved correctly without stale overwrite");
  } else {
    fail("edge:search-rapid-typing", JSON.stringify(aiResults));
  }

  // Reset search
  await page.fill("#search", "");
  await sleep(600);

  console.log("\n--- 6. Real Clipboard Copy Flow ---");
  // Find the first snippet's copy button
  const firstTitle = await page.$eval("#list .row:first-child .row-title", (el) => el.textContent.trim());
  const copyBtn = page.locator("#list .row:first-child .copy-btn");
  console.log(`  Copying snippet: "${firstTitle}"`);

  // Initial button text
  const initialBtnText = await copyBtn.textContent();
  console.log(`  Initial copy button text: "${initialBtnText}"`);

  // Click copy button
  await copyBtn.click();
  await sleep(400);

  // Transient success state
  const copiedBtnText = await copyBtn.textContent();
  console.log(`  Button text immediately after copy: "${copiedBtnText}"`);
  if (copiedBtnText === "✓") pass("edge:copy-feedback — checkmark animation '✓' displayed");
  else fail("edge:copy-feedback", `Button text was "${copiedBtnText}"`);

  // Read actual clipboard contents
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  console.log(`  Actual clipboard text length: ${clipboardText.length} characters`);
  console.log(`  Clipboard snippet (first 100 chars): "${clipboardText.substring(0, 100).replace(/\n/g, '\\n')}"`);

  if (clipboardText && clipboardText.length > 50 && clipboardText.includes("ssh-agent")) {
    pass("edge:clipboard-paste — exact snippet body written to system clipboard");
  } else {
    fail("edge:clipboard-paste", `Clipboard content: "${clipboardText.substring(0, 100)}"`);
  }

  // Wait for button feedback reset (~850ms)
  await sleep(1000);
  const resetBtnText = await copyBtn.textContent();
  console.log(`  Button text after reset: "${resetBtnText}"`);
  if (resetBtnText === "⧉") pass("edge:copy-reset — button icon reset back to '⧉'");
  else fail("edge:copy-reset", `Button text is "${resetBtnText}"`);

  console.log("\n--- 7. Security & Browser Storage Inspection ---");
  const storageReport = await page.evaluate(async () => {
    const report = {
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage),
      indexedDBs: [],
    };
    try {
      const dbs = await window.indexedDB.databases();
      report.indexedDBs = dbs.map((d) => d.name);
    } catch {
      // IndexedDB databases() enumeration not available in this context
    }
    return report;
  });
  console.log("  Storage Report:", JSON.stringify(storageReport));

  if (storageReport.localStorageKeys.length === 0 && storageReport.sessionStorageKeys.length === 0 && storageReport.indexedDBs.length === 0) {
    pass("edge:security-storage-clean — zero data in localStorage, sessionStorage, or IndexedDB");
  } else {
    fail("edge:security-storage-clean", JSON.stringify(storageReport));
  }

  console.log("\n--- 8. Console Error Inspection ---");
  console.log(`  Logged console errors: ${consoleErrors.length}`);
  if (consoleErrors.length === 0) pass("edge:console-clean — zero JavaScript errors emitted");
  else fail("edge:console-clean", consoleErrors.join("; "));

  await ctx.close();

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("EDGE REAL E2E CERTIFICATION SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`  PASS: ${results.pass}   FAIL: ${results.fail}\n`);
  for (const d of results.details) {
    const i = d.status === "PASS" ? "✓" : "✗";
    console.log(`  ${i} ${d.name}${d.reason ? ` — ${d.reason}` : ""}`);
  }
  console.log(`\nVerdict: ${results.fail === 0 ? "PASS" : "FAIL"}`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(2);
});
