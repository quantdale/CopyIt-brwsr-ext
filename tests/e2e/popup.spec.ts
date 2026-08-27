import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, normalize } from "node:path";

/**
 * Mock E2E for the V1 popup.
 *
 * This loads the REAL built `extension/dist/popup.html` (plus its bundle CSS/JS)
 * over a tiny static server, with only the native messaging + clipboard surfaces
 * replaced by an in-page mock. It therefore exercises the actual popup rendering,
 * state machine, search debounce, category rendering, tooltip behavior and the
 * copy / unlock-retry flows that ship in the extension — while never touching a
 * real browser extension or native host.
 *
 * It is a deliberate build gate: if `extension/dist` is missing the suite FAILS
 * loudly rather than silently skipping, so CI cannot report success on a stale
 * or absent artifact.
 */

const DIST = normalize(resolve("extension/dist"));
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
};

let server: Server;
let basePath: string;

test.beforeAll(async () => {
  const popupFile = resolve(DIST, "popup.html");
  if (!existsSync(popupFile)) {
    throw new Error(
      `E2E build artifact missing: ${popupFile}. Run \`npm run build\` before E2E.`,
    );
  }
  server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/popup.html").split("?")[0] ?? "/popup.html");
    const relative = urlPath === "/" ? "popup.html" : urlPath.replace(/^\/+/, "");
    const candidate = normalize(resolve(DIST, relative));
    if (!candidate.startsWith(resolve(DIST))) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    try {
      const body = await readFile(candidate);
      const ext = candidate.slice(candidate.lastIndexOf(".")).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (typeof address === "object" && address) {
    basePath = `http://127.0.0.1:${address.port}`;
  } else {
    throw new Error("e2e static server did not bind to a TCP port");
  }
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

/** Installs a fake `chrome.runtime` native transport + clipboard capture shim. */
function installMock(): void {
  void (() => {
    (window as unknown as { __phState: { vaultUnlocked: boolean } }).__phState = { vaultUnlocked: false };
    (window as unknown as { __requests: string[] }).__requests = [];
    (window as unknown as { __copied: string | null }).__copied = null;
    const state = () => (window as unknown as { __phState: { vaultUnlocked: boolean } }).__phState;
    const reqLog = () => (window as unknown as { __requests: string[] }).__requests;
    const copiedSink = (t: string) => {
      (window as unknown as { __copied: string | null }).__copied = t;
    };
    const listeners: Array<(msg: unknown) => void> = [];
    const port = {
      postMessage: (req: { method: string; requestId: string; params?: Record<string, unknown> }) => {
        const method = req.method;
        const id = req.requestId;
        reqLog().push(method);
        const emit = (payload: unknown) => setTimeout(() => listeners.forEach((l) => l(payload)), 5);
        const ok = (result: unknown) => emit({ protocolVersion: 1, requestId: id, ok: true, result });
        const fail = (code: string, message: string) =>
          emit({ protocolVersion: 1, requestId: id, ok: false, error: { code, message, retryable: false } });
        switch (method) {
          case "hello":
            return ok({
              protocolVersion: 1,
              hostVersion: "0.1.0",
              supportedSchemaVersion: 1,
              dbSchemaVersion: 1,
              vaultState: "not_configured",
              migrationStatus: "ready",
              dbReady: true,
              lastErrorCode: null,
            });
          case "listCategories":
            return ok({ categories: [{ name: "Git", count: 2 }, { name: "Prompt", count: 1 }] });
          case "listSnippets":
            return ok({
              items: [
                { id: 1, title: "Update all repos", description: "Pulls every repo.", category: "Git", protected: false },
                { id: 2, title: "Secret launch prompt", description: "Requires the vault passphrase.", category: "Prompt", protected: true },
                { id: 3, title: "Summarize conversation", description: "", category: "Prompt", protected: false },
              ],
              total: 3,
              offset: 0,
              pageSize: 100,
              hasMore: false,
            });
          case "unlockVault":
            state().vaultUnlocked = true;
            return ok({ vaultState: "unlocked" });
          case "getSnippetBody": {
            const idNum = Number((req.params ?? {}).id);
            if (idNum === 2 && !state().vaultUnlocked) return fail("vault_locked", "Vault is locked");
            return ok({ body: `cdn-body-${idNum}` });
          }
          case "lockVault":
            state().vaultUnlocked = false;
            return ok({ vaultState: "locked" });
          case "ping":
            return ok({ pong: true });
          default:
            return fail("unknown_method", "unknown method");
        }
      },
      onMessage: { addListener: (l: (msg: unknown) => void) => listeners.push(l) },
      onDisconnect: { addListener: () => {} },
      disconnect: () => {},
    };
    (window as unknown as { chrome: unknown }).chrome = {
      runtime: { connectNative: () => port, lastError: undefined },
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => copiedSink(text) },
    });
  })();
}

test.describe("popup (real bundle + mock native transport)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installMock);
  });

  const gotoPopup = (page: Page) => page.goto(`${basePath}/popup.html`);
  const rows = (page: Page) => page.locator(".row");
  const copied = (page: Page) =>
    page.evaluate(() => (window as unknown as { __copied: string | null }).__copied);
  const requests = (page: Page) =>
    page.evaluate(() => [...(window as unknown as { __requests: string[] }).__requests]);

  test("popup renders a dense title-only list", async ({ page }) => {
    await gotoPopup(page);
    await expect(page.locator("#search")).toBeVisible();
    await expect(page.locator("#category-filter")).toBeVisible();
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
    await expect(rows(page).first()).toContainText("Update all repos");
    await expect(page.locator(".row-title").last()).toHaveText("Summarize conversation");
  });

  test("tooltip shows on hover, is text-only, and dismisses on Escape", async ({ page }) => {
    await gotoPopup(page);
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
    await rows(page).first().hover();
    const tip = page.locator("#tooltip");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText("Pulls every repo.");
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
  });

  test("search triggers a debounced snippet request; category filter renders options", async ({ page }) => {
    await gotoPopup(page);
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
    await expect(page.locator("#category-filter option")).toHaveCount(3);
    await page.fill("#search", "repos");
    await expect.poll(() => requests(page)).toContain("listSnippets");
    await page.selectOption("#category-filter", "Git");
  });

  test("plaintext copy writes the body to the clipboard", async ({ page }) => {
    await gotoPopup(page);
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
    await rows(page).nth(2).locator(".copy-btn").click();
    await expect.poll(() => copied(page)).toBe("cdn-body-3");
  });

  test("protected copy opens the vault overlay and unlock retries the copy once", async ({ page }) => {
    await gotoPopup(page);
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
    await rows(page).nth(1).locator(".copy-btn").click();
    await expect(page.locator("#overlay")).toBeVisible();
    await page.fill("#vault-password", "correct horse battery staple");
    await page.click("#vault-unlock");
    await expect(page.locator("#overlay")).toBeHidden();
    await expect.poll(() => copied(page)).toBe("cdn-body-2");
  });
});
