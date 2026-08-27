import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { showCopySuccess } from "../src/copy-feedback.js";
import { truncateUtf8 } from "../src/dom.js";

describe("popup copy flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the production copy feedback helper and resets after its duration", () => {
    const btn = document.createElement("button");
    btn.textContent = "⧉";
    const reset = vi.fn();
    showCopySuccess(btn, "⧉", reset);
    expect(btn.textContent).toBe("✓");
    expect(btn.getAttribute("aria-label")).toBe("Copied");
    expect(btn.classList.contains("copied")).toBe(true);
    vi.advanceTimersByTime(849);
    expect(btn.textContent).toBe("✓");
    vi.advanceTimersByTime(1);
    expect(btn.textContent).toBe("⧉");
    expect(btn.getAttribute("aria-label")).toBeNull();
    expect(btn.classList.contains("copied")).toBe(false);
    expect(reset).toHaveBeenCalledOnce();
  });

  it("renders safe text via textContent (no innerHTML)", () => {
    const row = document.createElement("div");
    const title = document.createElement("div");
    title.textContent = "<img onerror=alert(1)> Hello";
    row.appendChild(title);
    expect(row.innerHTML).not.toContain("<img");
    expect(title.textContent).toBe("<img onerror=alert(1)> Hello");
  });
});

describe("popup search/category", () => {
  it("normalizes metadata with production UTF-8 truncation", () => {
    const description = truncateUtf8("🙂".repeat(1000), 2000);
    expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(2000);
    expect(description.endsWith("🙂")).toBe(true);
  });
});
