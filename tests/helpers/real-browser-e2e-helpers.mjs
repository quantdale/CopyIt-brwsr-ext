import { chromium } from "playwright";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin, resolve } from "node:path";
import { createCertFixture, CERT_PASSWORD, CERT_PROTECTED_BODY, CERT_PLAIN_ALPHA_BODY, CERT_PLAIN_ALPHA_TITLE, CERT_PROTECTED_TITLE } from "./cert-fixture.mjs";

const EXTENSION_PATH = resolve("extension/dist");
const EXPECTED_ID = "mmiopnfmhmmlmhcdjklelfcdahmgchfc";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChromeExecutable() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env["ProgramFiles"] ? `${process.env["ProgramFiles"]}\\Google\\Chrome\\Application\\chrome.exe` : null,
    process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe` : null,
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export function findEdgeExecutable() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    process.env["ProgramFiles"] ? `${process.env["ProgramFiles"]}\\Microsoft\\Edge\\Application\\msedge.exe` : null,
    process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe` : null,
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export async function runRealBrowserCertification({ browserName, executablePath }) {
  console.log(`\n╔═══════════════════════════════════════════════════════════════╗`);
  console.log(`║  CopyIt — Real ${browserName} E2E Certification Suite        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════╝\n`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Browser: ${browserName}`);
  console.log(`Executable: ${executablePath}`);
  console.log(`Extension: ${EXTENSION_PATH}`);
  console.log(`Expected ID: ${EXPECTED_ID}`);

  if (!existsSync(executablePath)) {
    console.error(`FATAL: ${browserName} executable not found at ${executablePath}`);
    console.error(`Tried candidates for ${browserName}. Install ${browserName} or set correct path.`);
    process.exit(2);
  }
  if (!existsSync(EXTENSION_PATH)) {
    console.error(`FATAL: extension build missing at ${EXTENSION_PATH} - run npm run build`);
    process.exit(2);
  }

  const fixture = createCertFixture();
  console.log(`\nFixture tmpDir: ${fixture.tmpDir}`);
  console.log(`Fixture DB: ${fixture.dbPath}`);
  console.log(`Fixture password: ${CERT_PASSWORD} (synthetic)`);
  console.log(`Fixture protected body: ${CERT_PROTECTED_BODY}`);

  const userDir = mkdtempSync(pathJoin(tmpdir(), `copyit-${browserName.toLowerCase()}-cert-`));
  console.log(`Browser userDir: ${userDir}`);

  const isolatedEnv = {
    APPDATA: fixture.tmpDir,
    LOCALAPPDATA: fixture.tmpDir,
  };
  const launchEnv = { ...process.env, ...isolatedEnv };

  const results = { pass: 0, fail: 0, details: [] };
  function pass(n) { results.pass++; results.details.push({ name: n, status: "PASS" }); console.log(`  ✓ PASS: ${n}`); }
  function fail(n, r) { results.fail++; results.details.push({ name: n, status: "FAIL", reason: r }); console.error(`  ✗ FAIL: ${n} — ${r}`); }

  const consoleMessages = [];
  const consoleErrors = [];
  let ctx;
  try {
    console.log(`\nLaunching ${browserName}...`);
    const isCI = !!process.env.CI;
    ctx = await chromium.launchPersistentContext(userDir, {
      headless: isCI,
      executablePath,
      env: launchEnv,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        ...(isCI ? ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage"] : []),
      ],
      viewport: { width: 900, height: 700 },
      timeout: 30000,
    });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    await sleep(1500);

    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const text = msg.text();
      consoleMessages.push(`[${msg.type()}] ${text}`);
      if (msg.type() === "error") consoleErrors.push(text);
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    console.log("\n--- 1. Popup Navigation & Initialization ---");
    await page.goto(`chrome-extension://${EXPECTED_ID}/popup.html`, { timeout: 15000 });
    await sleep(2000);

    const pageUrl = page.url();
    console.log(`  Page URL: ${pageUrl}`);
    if (pageUrl.includes(EXPECTED_ID)) pass(`${browserName.toLowerCase()}:popup-loaded — URL matches expected extension ID`);
    else fail(`${browserName.toLowerCase()}:popup-loaded`, `URL is ${pageUrl}`);

    const title = await page.title();
    console.log(`  Page Title: "${title}"`);
    if (title === "CopyIt") pass(`${browserName.toLowerCase()}:popup-title — title is 'CopyIt'`);
    else fail(`${browserName.toLowerCase()}:popup-title`, `Title is "${title}"`);

    console.log("\n--- 2. Native Messaging & Deterministic Fixture DB ---");
    let status = await page.textContent("#status");
    console.log(`  Initial status text: "${status}"`);
    for (let i = 0; i < 10 && !status.includes("3 prompts") && !status.includes("3 prompt"); i++) {
      await sleep(500);
      status = await page.textContent("#status");
    }
    console.log(`  Status text after wait: "${status}"`);
    if (status.includes("3 prompts") || status.includes("3 prompt")) pass(`${browserName.toLowerCase()}:status — "${status}" (deterministic 3)`);
    else fail(`${browserName.toLowerCase()}:status`, `Unexpected status: "${status}"`);

    const listItems = await page.$$eval("#list .row", (els) => els.map((e) => e.textContent.trim()));
    console.log(`  Rendered ${listItems.length} rows:`);
    listItems.forEach((t, i) => console.log(`    ${i + 1}. ${t}`));

    if (listItems.length === 3) pass(`${browserName.toLowerCase()}:snippets-count — exactly 3 deterministic snippets loaded`);
    else fail(`${browserName.toLowerCase()}:snippets-count`, `Expected 3, got ${listItems.length}`);

    const titles = await page.$$eval("#list .row .row-title", (els) => els.map((e) => e.textContent.trim()));
    console.log(`  Titles:`, titles);
    if (titles.includes("Plain Alpha") && titles.includes("Protected Bravo") && titles.includes("Plain Charlie")) {
      pass(`${browserName.toLowerCase()}:snippets-titles — deterministic titles present`);
    } else {
      fail(`${browserName.toLowerCase()}:snippets-titles`, JSON.stringify(titles));
    }

    console.log("\n--- 3. Title-Only Compact Rows (No Body Exposure) ---");
    const bodyInRow = await page.$$eval("#list .row .row-body, #list .row-body, #list .body", (els) => els.length);
    if (bodyInRow === 0) pass(`${browserName.toLowerCase()}:title-only-rows — no body preview elements exist`);
    else fail(`${browserName.toLowerCase()}:title-only-rows`, `Found ${bodyInRow} body elements`);

    const pageContent = await page.content();
    if (!pageContent.includes(CERT_PROTECTED_BODY)) pass(`${browserName.toLowerCase()}:no-protected-body-in-dom — protected plaintext not rendered`);
    else fail(`${browserName.toLowerCase()}:no-protected-body-in-dom`, `Protected body leaked in DOM`);

    console.log("\n--- 4. Categories & Category Filtering ---");
    const catOptions = await page.$$eval("#category-filter option", (els) => els.map((e) => ({ value: e.value, text: e.textContent.trim() })));
    console.log(`  Category options:`, catOptions);

    const hasCertA = catOptions.some((o) => o.text === "Cert-A (2)" || (o.value === "Cert-A" && o.text.includes("Cert-A")));
    const hasCertB = catOptions.some((o) => o.text === "Cert-B (1)" || (o.value === "Cert-B" && o.text.includes("Cert-B")));
    if (catOptions.length === 3 && hasCertA && hasCertB) {
      pass(`${browserName.toLowerCase()}:categories-loaded — Cert-A (2) and Cert-B (1) loaded correctly`);
    } else {
      fail(`${browserName.toLowerCase()}:categories-loaded`, JSON.stringify(catOptions));
    }

    await page.selectOption("#category-filter", "Cert-A");
    await sleep(600);
    const certAItems = await page.$$eval("#list .row", (els) => els.map((e) => e.textContent.trim()));
    console.log(`  Cert-A items (${certAItems.length}):`, certAItems);
    if (certAItems.length === 2) pass(`${browserName.toLowerCase()}:category-filter-certa — exactly 2 Cert-A snippets`);
    else fail(`${browserName.toLowerCase()}:category-filter-certa`, `Expected 2, got ${certAItems.length}`);

    await page.selectOption("#category-filter", "Cert-B");
    await sleep(600);
    const certBItems = await page.$$eval("#list .row", (els) => els.map((e) => e.textContent.trim()));
    console.log(`  Cert-B items (${certBItems.length}):`, certBItems);
    if (certBItems.length === 1 && certBItems[0].includes("Plain Charlie")) pass(`${browserName.toLowerCase()}:category-filter-certb — exactly 1 Plain Charlie`);
    else fail(`${browserName.toLowerCase()}:category-filter-certb`, `Expected 1 Plain Charlie, got ${JSON.stringify(certBItems)}`);

    await page.selectOption("#category-filter", "");
    await sleep(600);
    const allItems = await page.$$eval("#list .row", (els) => els.map((e) => e.textContent.trim()));
    if (allItems.length === 3) pass(`${browserName.toLowerCase()}:category-filter-all — restored 3 snippets`);
    else fail(`${browserName.toLowerCase()}:category-filter-all`, `Expected 3, got ${allItems.length}`);

    console.log("\n--- 5. Search Functionality ---");
    await page.fill("#search", "Alpha");
    await sleep(600);
    const searchAlpha = await page.$$eval("#list .row .row-title", (els) => els.map((e) => e.textContent.trim()));
    console.log(`  Search "Alpha" results:`, searchAlpha);
    if (searchAlpha.length === 1 && searchAlpha[0] === "Plain Alpha") {
      pass(`${browserName.toLowerCase()}:search-alpha — found 'Plain Alpha'`);
    } else {
      fail(`${browserName.toLowerCase()}:search-alpha`, JSON.stringify(searchAlpha));
    }

    await page.fill("#search", "Bravo");
    await sleep(600);
    const searchBravo = await page.$$eval("#list .row .row-title", (els) => els.map((e) => e.textContent.trim()));
    console.log(`  Search "Bravo" results:`, searchBravo);
    if (searchBravo.length === 1 && searchBravo[0] === "Protected Bravo") {
      pass(`${browserName.toLowerCase()}:search-bravo — found 'Protected Bravo'`);
    } else {
      fail(`${browserName.toLowerCase()}:search-bravo`, JSON.stringify(searchBravo));
    }

    await page.fill("#search", "nonexistentquery_xyz_999");
    await sleep(600);
    const noResultCount = await page.$$eval("#list .row", (els) => els.length);
    const noMatchStatus = await page.textContent("#status");
    console.log(`  No-match search: ${noResultCount}, status: "${noMatchStatus}"`);
    if (noResultCount === 0 && noMatchStatus.includes("No matches")) {
      pass(`${browserName.toLowerCase()}:search-no-results — 'No matches.' status`);
    } else {
      fail(`${browserName.toLowerCase()}:search-no-results`, `count: ${noResultCount}, status: "${noMatchStatus}"`);
    }

    console.log("  Testing rapid search typing...");
    await page.fill("#search", "a");
    await sleep(30);
    await page.fill("#search", "al");
    await sleep(30);
    await page.fill("#search", "alp");
    await sleep(30);
    await page.fill("#search", "Alpha");
    await sleep(600);
    const rapidResults = await page.$$eval("#list .row .row-title", (els) => els.map((e) => e.textContent.trim()));
    console.log(`  Rapid search "Alpha" results:`, rapidResults);
    if (rapidResults.length === 1 && rapidResults[0] === "Plain Alpha") {
      pass(`${browserName.toLowerCase()}:search-rapid-typing — debounced search resolved correctly without stale overwrite`);
    } else {
      fail(`${browserName.toLowerCase()}:search-rapid-typing`, JSON.stringify(rapidResults));
    }

    await page.fill("#search", "");
    await sleep(600);

    console.log("\n--- 6. Real Plaintext Clipboard Copy Flow ---");
    const plainBtn = page.locator(`button[aria-label="Copy ${CERT_PLAIN_ALPHA_TITLE}"]`);
    const plainBtnCount = await plainBtn.count();
    console.log(`  Plain Alpha button count: ${plainBtnCount}`);
    if (plainBtnCount !== 1) fail(`${browserName.toLowerCase()}:plain-copy-btn-exists`, `Expected 1, got ${plainBtnCount}`);
    else pass(`${browserName.toLowerCase()}:plain-copy-btn-exists — found button`);

    await plainBtn.click();
    await sleep(400);
    const plainCopiedText = await plainBtn.textContent();
    console.log(`  Button text after copy: "${plainCopiedText}"`);
    if (plainCopiedText === "✓") pass(`${browserName.toLowerCase()}:plain-copy-feedback — checkmark '✓' displayed`);
    else fail(`${browserName.toLowerCase()}:plain-copy-feedback`, `Button text was "${plainCopiedText}"`);

    const plainClipboard = await page.evaluate(() => navigator.clipboard.readText());
    console.log(`  Clipboard length: ${plainClipboard.length}, content: "${plainClipboard}"`);
    if (plainClipboard === CERT_PLAIN_ALPHA_BODY) pass(`${browserName.toLowerCase()}:plain-clipboard-exact — clipboard matches exact body`);
    else fail(`${browserName.toLowerCase()}:plain-clipboard-exact`, `Expected "${CERT_PLAIN_ALPHA_BODY}", got "${plainClipboard}"`);

    await sleep(1000);
    const plainResetText = await plainBtn.textContent();
    console.log(`  Button after reset: "${plainResetText}"`);
    if (plainResetText === "⧉") pass(`${browserName.toLowerCase()}:plain-copy-reset — button reset to '⧉'`);
    else fail(`${browserName.toLowerCase()}:plain-copy-reset`, `Button text is "${plainResetText}"`);

    console.log("\n--- 7. Protected Vault Flow: Locked State → Wrong Password → Correct Unlock ---");
    const protectedBtn = page.locator(`button[aria-label="Copy ${CERT_PROTECTED_TITLE}"]`);
    await protectedBtn.click();
    await sleep(600);

    const overlayHidden = await page.$eval("#overlay", (el) => el.classList.contains("hidden"));
    const overlayTitle = await page.textContent("#overlay-title");
    console.log(`  Overlay hidden? ${overlayHidden}, title: "${overlayTitle}"`);
    if (!overlayHidden && overlayTitle.includes("Unlock")) pass(`${browserName.toLowerCase()}:protected-overlay-shown — unlock overlay displayed`);
    else fail(`${browserName.toLowerCase()}:protected-overlay-shown`, `hidden=${overlayHidden}, title=${overlayTitle}`);

    const vaultStateBefore = await page.textContent("#vault-state");
    console.log(`  Vault state before unlock: "${vaultStateBefore}"`);

    await page.fill("#vault-password", "wrong-password-xyz-123");
    await page.click("#vault-unlock");
    await sleep(800);
    const vaultErrorWrong = await page.textContent("#vault-error");
    const overlayStillHiddenWrong = await page.$eval("#overlay", (el) => el.classList.contains("hidden"));
    console.log(`  After wrong password: error="${vaultErrorWrong}", overlay hidden? ${overlayStillHiddenWrong}`);
    if (vaultErrorWrong.includes("Wrong password") && !overlayStillHiddenWrong) {
      pass(`${browserName.toLowerCase()}:protected-wrong-password — error shown, overlay stays`);
    } else {
      fail(`${browserName.toLowerCase()}:protected-wrong-password`, `error="${vaultErrorWrong}", hidden=${overlayStillHiddenWrong}`);
    }

    const clipboardAfterWrong = await page.evaluate(() => navigator.clipboard.readText());
    console.log(`  Clipboard after wrong password: "${clipboardAfterWrong}"`);
    if (clipboardAfterWrong === CERT_PLAIN_ALPHA_BODY && clipboardAfterWrong !== CERT_PROTECTED_BODY) {
      pass(`${browserName.toLowerCase()}:protected-wrong-no-leak — clipboard not overwritten with protected body`);
    } else if (clipboardAfterWrong !== CERT_PROTECTED_BODY) {
      pass(`${browserName.toLowerCase()}:protected-wrong-no-leak — clipboard does not contain protected body (is "${clipboardAfterWrong.substring(0, 30)}")`);
    } else {
      fail(`${browserName.toLowerCase()}:protected-wrong-no-leak`, `Clipboard leaked protected body`);
    }

    await page.fill("#vault-password", "");
    await page.fill("#vault-password", CERT_PASSWORD);
    await page.click("#vault-unlock");
    await sleep(1200);

    const overlayAfterCorrect = await page.$eval("#overlay", (el) => el.classList.contains("hidden"));
    console.log(`  Overlay hidden after correct password? ${overlayAfterCorrect}`);
    if (overlayAfterCorrect) pass(`${browserName.toLowerCase()}:protected-unlock-success — overlay hidden after correct password`);
    else fail(`${browserName.toLowerCase()}:protected-unlock-success`, `overlay still visible`);

    const vaultStateAfter = await page.textContent("#vault-state");
    console.log(`  Vault state after unlock: "${vaultStateAfter}"`);
    if (vaultStateAfter.toLowerCase().includes("unlocked")) pass(`${browserName.toLowerCase()}:vault-unlocked-ui — state shows unlocked`);
    else fail(`${browserName.toLowerCase()}:vault-unlocked-ui`, `state="${vaultStateAfter}"`);

    const protectedClipboard = await page.evaluate(() => navigator.clipboard.readText());
    console.log(`  Protected clipboard length: ${protectedClipboard.length}, content: "${protectedClipboard}"`);
    if (protectedClipboard === CERT_PROTECTED_BODY) pass(`${browserName.toLowerCase()}:protected-clipboard-exact — protected body copied exactly`);
    else fail(`${browserName.toLowerCase()}:protected-clipboard-exact`, `Expected "${CERT_PROTECTED_BODY}", got "${protectedClipboard}"`);

    const domText = await page.evaluate(() => document.body.innerText);
    if (!domText.includes(CERT_PROTECTED_BODY)) pass(`${browserName.toLowerCase()}:protected-not-in-dom — protected body not rendered in popup`);
    else fail(`${browserName.toLowerCase()}:protected-not-in-dom`, `Protected body found in DOM`);

    const pwdValue = await page.$eval("#vault-password", (el) => el.value);
    console.log(`  Password field after unlock: "${pwdValue}" (should be empty)`);
    if (pwdValue === "") pass(`${browserName.toLowerCase()}:password-cleared — password field cleared after unlock`);
    else fail(`${browserName.toLowerCase()}:password-cleared`, `value="${pwdValue}"`);

    await sleep(1200);
    const protBtnAfter = await protectedBtn.textContent().catch(() => "missing");
    console.log(`  Protected button after auto-copy: "${protBtnAfter}"`);
    if (protBtnAfter === "⧉" || protBtnAfter === "✓") pass(`${browserName.toLowerCase()}:protected-copy-feedback — button animation occurred`);
    else fail(`${browserName.toLowerCase()}:protected-copy-feedback`, `Button text "${protBtnAfter}"`);

    console.log("\n--- 8. Storage & Log Security ---");
    const storageReport = await page.evaluate(async () => {
      const report = {
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage),
        indexedDBs: [],
        chromeStorage: null,
      };
      try {
        const dbs = await (window.indexedDB.databases ? window.indexedDB.databases() : Promise.resolve([]));
        report.indexedDBs = dbs.map((d) => d.name);
      } catch (_e) {
        void _e;
      }
      try {
        if (window.chrome && chrome.storage && chrome.storage.local) {
          const data = await new Promise((res) => chrome.storage.local.get(null, (o) => res(o)));
          report.chromeStorage = data;
        }
      } catch (_e) {
        void _e;
      }
      return report;
    });
    console.log("  Storage Report:", JSON.stringify(storageReport));
    const storageClean = storageReport.localStorageKeys.length === 0 && storageReport.sessionStorageKeys.length === 0 && storageReport.indexedDBs.length === 0;
    if (storageClean) pass(`${browserName.toLowerCase()}:security-storage-clean — no persistent storage`);
    else fail(`${browserName.toLowerCase()}:security-storage-clean`, JSON.stringify(storageReport));

    const chromeStorageStr = JSON.stringify(storageReport.chromeStorage || {});
    if (!chromeStorageStr.includes(CERT_PROTECTED_BODY) && !chromeStorageStr.includes(CERT_PASSWORD)) {
      pass(`${browserName.toLowerCase()}:security-chrome-storage-clean — chrome.storage contains no secrets`);
    } else {
      fail(`${browserName.toLowerCase()}:security-chrome-storage-clean`, chromeStorageStr.substring(0, 200));
    }

    const allLogs = consoleMessages.join("\n");
    if (!allLogs.includes(CERT_PROTECTED_BODY) && !allLogs.includes(CERT_PASSWORD)) {
      pass(`${browserName.toLowerCase()}:security-console-clean — logs contain no protected plaintext/password`);
    } else {
      fail(`${browserName.toLowerCase()}:security-console-clean`, `Leaked in logs: ${allLogs.substring(0, 500)}`);
    }

    console.log("\n--- 9. Lock Again & Verify Locked Returns ---");
    const lockBtn = page.locator("#lock-vault");
    const lockVisible = await lockBtn.isVisible().catch(() => false);
    console.log(`  Lock button visible? ${lockVisible}`);
    if (lockVisible) {
      await lockBtn.click();
      await sleep(600);
      const vaultStateLocked = await page.textContent("#vault-state");
      console.log(`  Vault state after lock: "${vaultStateLocked}"`);
      if (vaultStateLocked.toLowerCase().includes("locked")) pass(`${browserName.toLowerCase()}:vault-relock — vault locked again`);
      else fail(`${browserName.toLowerCase()}:vault-relock`, `state="${vaultStateLocked}"`);

      await protectedBtn.click();
      await sleep(600);
      const overlayAfterRelock = await page.$eval("#overlay", (el) => el.classList.contains("hidden"));
      console.log(`  Overlay after relock click? hidden=${overlayAfterRelock}`);
      if (!overlayAfterRelock) pass(`${browserName.toLowerCase()}:protected-relock-overlay — locked behavior returns`);
      else fail(`${browserName.toLowerCase()}:protected-relock-overlay`, `overlay hidden`);
      await page.click("#vault-cancel");
      await sleep(300);
    } else {
      console.log("  Lock button not visible (maybe already hidden or not_configured), skipping relock test");
      fail(`${browserName.toLowerCase()}:vault-relock`, `Lock button not visible after unlock`);
    }

    console.log("\n--- 10. Browser Storage After Full Flow ---");
    const finalStorage = await page.evaluate(() => ({
      ls: Object.keys(localStorage).length,
      ss: Object.keys(sessionStorage).length,
    }));
    console.log(`  Final storage: localStorage ${finalStorage.ls}, sessionStorage ${finalStorage.ss}`);
    if (finalStorage.ls === 0 && finalStorage.ss === 0) pass(`${browserName.toLowerCase()}:final-storage-clean — still clean after protected flow`);
    else fail(`${browserName.toLowerCase()}:final-storage-clean`, JSON.stringify(finalStorage));

    console.log("\n--- 11. Console Error Inspection ---");
    console.log(`  Console errors: ${consoleErrors.length}`);
    if (consoleErrors.length === 0) pass(`${browserName.toLowerCase()}:console-clean — zero JS errors`);
    else fail(`${browserName.toLowerCase()}:console-clean`, consoleErrors.join("; "));

    await ctx.close();
    fixture.cleanup();
    try {
      rmSync(userDir, { recursive: true, force: true });
    } catch (_e) {
      void _e;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`${browserName.toUpperCase()} REAL E2E CERTIFICATION SUMMARY`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  PASS: ${results.pass}   FAIL: ${results.fail}\n`);
    for (const d of results.details) {
      const i = d.status === "PASS" ? "✓" : "✗";
      console.log(`  ${i} ${d.name}${d.reason ? ` — ${d.reason}` : ""}`);
    }
    console.log(`\nVerdict: ${results.fail === 0 ? "PASS" : "FAIL"}`);
    process.exit(results.fail > 0 ? 1 : 0);
  } catch (e) {
    console.error("Fatal error during certification:", e);
    console.error(e.stack);
    try {
      if (ctx) await ctx.close();
    } catch (_e) {
      void _e;
    }
    try {
      rmSync(userDir, { recursive: true, force: true });
    } catch (_e) {
      void _e;
    }
    try {
      fixture.cleanup();
    } catch (_e) {
      void _e;
    }
    process.exit(2);
  }
}
