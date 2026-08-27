import { describe, it, expect, vi } from "vitest";

describe("clipboard", () => {
  it("writeText uses navigator.clipboard when available", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { writeText: wt } = await import("../src/clipboard.js");
    await wt("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when clipboard unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const execSpy = vi.fn(() => true);
    document.execCommand = execSpy as unknown as typeof document.execCommand;
    const { writeText: wt } = await import("../src/clipboard.js");
    await wt("fallback");
    expect(execSpy).toHaveBeenCalledWith("copy");
  });
});
