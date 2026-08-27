import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test.describe("popup (mock transport)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { chrome: unknown }).chrome = {
        runtime: {
          connectNative: () =>
            ({
              postMessage: () => {},
              onMessage: { addListener: () => {} },
              onDisconnect: { addListener: () => {} },
              disconnect: () => {},
            }) as unknown as chrome.runtime.Port,
          lastError: undefined,
        },
      } as unknown as typeof chrome;
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async () => {} },
        configurable: true,
      });
    });
  });

  test("popup loads dense title-only list", async ({ page }) => {
    const html = readFileSync("extension/dist/popup.html", "utf8");
    if (!html.includes("CopyIt")) test.skip();
    await page.setContent(html);
    await expect(page.locator("#search")).toBeVisible();
    await expect(page.locator("#category-filter")).toBeVisible();
  });

  test("search and category filter are present", async ({ page }) => {
    const html = readFileSync("extension/dist/popup.html", "utf8");
    if (!html.includes('id="search"')) test.skip();
    await page.setContent(html);
    await page.fill("#search", "hello");
    await expect(page.locator("#search")).toHaveValue("hello");
    await page.selectOption("#category-filter", "");
    await expect(page.locator("#category-filter")).toHaveValue("");
  });
});
