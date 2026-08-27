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
    (window as unknown as { __requests: Array<{ method: string; params?: Record<string, unknown> }> }).__requests = [];
    (window as unknown as { __copied: string | null }).__copied = null;
    (window as unknown as { __lockFailure: boolean }).__lockFailure = false;
    const state = () => (window as unknown as { __phState: { vaultUnlocked: boolean } }).__phState;
    const reqLog = () => (window as unknown as { __requests: Array<{ method: string; params?: Record<string, unknown> }> }).__requests;
    const copiedSink = (t: string) => {
      (window as unknown as { __copied: string | null }).__copied = t;
    };
    const allItems = [
      { id: 1, title: "Update all repos", description: "Pulls every repo.", category: "Git", protected: false },
      { id: 2, title: "Secret launch prompt", description: "Requires the vault passphrase.", category: "Prompt", protected: true },
      { id: 3, title: "Summarize conversation", description: "This is a deliberately long tooltip description. ".repeat(80), category: "Prompt", protected: false },
    ];
    const manyItems = Array.from({ length: 125 }, (_, index) => ({
      id: 1000 + index,
      title: `Many result ${index + 1}`,
      description: "Synthetic pagination item",
      category: index % 2 === 0 ? "Git" : "Prompt",
      protected: false,
    }));
    const listeners: Array<(msg: unknown) => void> = [];
    const port = {
      postMessage: (req: { method: string; requestId: string; params?: Record<string, unknown> }) => {
        const method = req.method;
        const id = req.requestId;
        reqLog().push({ method, params: req.params });
        const emit = (payload: unknown, delay = 5) => setTimeout(() => listeners.forEach((l) => l(payload)), delay);
        const ok = (result: unknown, delay = 5) => emit({ protocolVersion: 1, requestId: id, ok: true, result }, delay);
        const fail = (code: string, message: string, delay = 5) =>
          emit({ protocolVersion: 1, requestId: id, ok: false, error: { code, message, retryable: false } }, delay);
        switch (method) {
          case "hello":
            if (new URLSearchParams(window.location.search).get("mode") === "host-error") {
              return fail("database_unavailable", "CopyIt native host is not installed or registered.");
            }
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
            {
              const query = String(req.params?.query ?? "").toLowerCase();
              const category = String(req.params?.category ?? "").toLowerCase();
              if (new URLSearchParams(window.location.search).get("mode") === "empty") {
                return ok({ items: [], total: 0, offset: 0, pageSize: Number(req.params?.limit ?? 100), hasMore: false });
              }
              const sourceItems = query === "many" ? manyItems : allItems;
              const filteredItems = sourceItems.filter((item) => {
                const matchesQuery = !query || [item.title, item.description, item.category]
                  .some((value) => value.toLowerCase().includes(query));
                const matchesCategory = !category || item.category.toLowerCase() === category;
                return matchesQuery && matchesCategory;
              });
              const offset = Number(req.params?.offset ?? 0);
              const pageSize = Number(req.params?.limit ?? 100);
              // Delay one deliberately stale response so the test exercises the
              // production generation guard rather than a mock-only debounce.
              const delay = query === "a" ? 250 : 5;
              return ok({
                items: filteredItems.slice(offset, offset + pageSize),
                total: filteredItems.length,
                offset,
                pageSize,
                hasMore: offset + pageSize < filteredItems.length,
              }, delay);
            }
          case "unlockVault":
            if (req.params?.password !== "correct horse battery staple") return fail("invalid_password", "Invalid password");
            state().vaultUnlocked = true;
            return ok({ vaultState: "unlocked" });
          case "getSnippetBody": {
            const idNum = Number((req.params ?? {}).id);
            if (idNum === 2 && !state().vaultUnlocked) return fail("vault_locked", "Vault is locked");
            return ok({ body: `cdn-body-${idNum}` });
          }
          case "lockVault":
            if ((window as unknown as { __lockFailure: boolean }).__lockFailure) return fail("database_busy", "Database is busy");
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

  const gotoPopup = (page: Page, mode?: string) => page.goto(`${basePath}/popup.html${mode ? `?mode=${mode}` : ""}`);
  const rows = (page: Page) => page.locator(".row");
  const copied = (page: Page) =>
    page.evaluate(() => (window as unknown as { __copied: string | null }).__copied);
  const requests = (page: Page) =>
    page.evaluate(() => (window as unknown as { __requests: Array<{ method: string }> }).__requests.map((request) => request.method));
  const bodyRequestCount = (page: Page, id: number) =>
    page.evaluate((snippetId) =>
      (window as unknown as { __requests: Array<{ method: string; params?: Record<string, unknown> }> }).__requests
        .filter((request) => request.method === "getSnippetBody" && Number(request.params?.id) === snippetId).length,
    id);

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
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Update all repos");
  });

  test("keyboard focus exposes the tooltip accessibly", async ({ page }) => {
    await gotoPopup(page);
    const firstRow = rows(page).first();
    await expect(firstRow).toHaveCount(1, { timeout: 5000 });
    await firstRow.focus();
    await expect(firstRow).toBeFocused();
    await expect(page.locator("#tooltip")).toBeVisible();
    await expect(firstRow).toHaveAttribute("aria-describedby", "tooltip");
  });

  test("long tooltip text stays within the popup viewport", async ({ page }) => {
    await gotoPopup(page);
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
    await rows(page).nth(2).hover();
    const tip = page.locator("#tooltip");
    await expect(tip).toBeVisible();
    const box = await tip.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(320);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test("stale search responses cannot replace newer results", async ({ page }) => {
    await gotoPopup(page);
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });

    await page.fill("#search", "a");
    await page.waitForTimeout(150);
    await page.fill("#search", "Secret");

    await expect(page.locator(".row-title")).toHaveText(["Secret launch prompt"], { timeout: 2000 });
    await page.waitForTimeout(300);
    await expect(page.locator(".row-title")).toHaveText(["Secret launch prompt"]);
  });

  test("100+ results paginate without losing title-only rows", async ({ page }) => {
    await gotoPopup(page);
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
    await page.fill("#search", "many");
    await expect(rows(page)).toHaveCount(100, { timeout: 5000 });
    await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
    await page.locator("#list").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(rows(page)).toHaveCount(125, { timeout: 5000 });
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
    await expect(page.locator(".snippet-body")).toHaveCount(0);
  });

  test("empty and host-error states are explicit", async ({ page }) => {
    await gotoPopup(page, "empty");
    await expect(page.locator("#status")).toHaveText("No prompts yet. Add some in the desktop app.", { timeout: 5000 });
    await expect(rows(page)).toHaveCount(0);

    await gotoPopup(page, "host-error");
    await expect(page.locator("#status")).toHaveText("CopyIt native host is not installed or registered.", { timeout: 5000 });
    await expect(page.locator("#status")).toHaveClass(/error/);
  });

  test("plaintext copy writes the body to the clipboard", async ({ page }) => {
    await gotoPopup(page);
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
    const copyButton = rows(page).nth(2).locator(".copy-btn");
    await copyButton.click();
    await expect.poll(() => copied(page)).toBe("cdn-body-3");
    await expect(copyButton).toHaveAttribute("aria-label", "Copied");
    await expect(copyButton).toHaveAttribute("aria-label", "Copy Summarize conversation", { timeout: 2000 });
  });

  test("unlock dialog traps focus and returns focus after cancel", async ({ page }) => {
    await gotoPopup(page);
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
    const protectedButton = rows(page).nth(1).locator(".copy-btn");
    await protectedButton.click();
    await expect(page.locator("#vault-password")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.locator("#vault-cancel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#vault-unlock")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#vault-password")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#vault-unlock")).toBeFocused();

    await page.click("#vault-cancel");
    await expect(page.locator("#overlay")).toBeHidden();
    await expect(protectedButton).toBeFocused();
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
    await expect.poll(() => bodyRequestCount(page, 2)).toBe(2);
    await expect(rows(page).nth(1).locator(".copy-btn")).toHaveText("✓");
  });

  test("lock failure remains visible and does not claim the vault is locked", async ({ page }) => {
    await gotoPopup(page);
    await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
    await rows(page).nth(1).locator(".copy-btn").click();
    await page.fill("#vault-password", "correct horse battery staple");
    await page.click("#vault-unlock");
    await expect(page.locator("#overlay")).toBeHidden();
    await page.evaluate(() => ((window as unknown as { __lockFailure: boolean }).__lockFailure = true));
    await page.click("#lock-vault");
    await expect(page.locator("#status")).toHaveText("Could not lock the vault. Try again.");
    await expect(page.locator("#vault-state")).toHaveText("Vault unlocked");
    await expect(page.locator("#lock-vault")).toBeVisible();
  });
});
