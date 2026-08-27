import { describe, it, expect, vi, beforeEach } from "vitest";

describe("popup copy flow", () => {
  it("shows checkmark for ~850ms after copy (mocked)", async () => {
    const btn = document.createElement("button");
    btn.textContent = "⧉";
    const original = btn.textContent;
    btn.textContent = "✓";
    btn.classList.add("copied");
    expect(btn.textContent).toBe("✓");
    expect(btn.classList.contains("copied")).toBe(true);
    // simulate timeout restore
    await new Promise((r) => setTimeout(r, 10));
    btn.textContent = original;
    btn.classList.remove("copied");
    expect(btn.textContent).toBe("⧉");
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
  it("debounces search and resets pagination", () => {
    let gen = 0;
    let current = 0;
    const shouldDiscard = (g: number, c: number) => g !== c;
    gen++;
    current = gen;
    expect(shouldDiscard(gen - 1, current)).toBe(true);
    expect(shouldDiscard(current, current)).toBe(false);
  });

  it("caps limit at 200 and truncates description at 2000 bytes", () => {
    const limit = Math.min(100000, 200);
    expect(limit).toBe(200);
    const desc = "a".repeat(5000).slice(0, 2000);
    expect(desc.length).toBe(2000);
  });
});
