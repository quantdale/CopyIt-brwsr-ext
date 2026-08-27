import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Tooltip } from "../src/tooltip.js";

describe("Tooltip", () => {
  let tipEl: HTMLElement;
  let tooltip: Tooltip;

  beforeEach(() => {
    document.body.innerHTML = '<div id="tooltip" class="tooltip hidden" role="tooltip"></div><div id="target">Title</div>';
    tipEl = document.getElementById("tooltip") as HTMLElement;
    tooltip = new Tooltip(tipEl);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    tooltip.destroy();
  });

  it("shows after hover delay and hides on leave", () => {
    const target = document.getElementById("target") as HTMLElement;
    tooltip.attach(target, "Hello description");
    target.dispatchEvent(new Event("mouseenter"));
    expect(tipEl.classList.contains("hidden")).toBe(true);
    vi.advanceTimersByTime(300);
    expect(tipEl.classList.contains("hidden")).toBe(false);
    expect(tipEl.textContent).toBe("Hello description");
    target.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(120);
    expect(tipEl.classList.contains("hidden")).toBe(true);
  });

  it("does not show empty description", () => {
    const target = document.getElementById("target") as HTMLElement;
    tooltip.attach(target, "");
    target.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(500);
    expect(tipEl.classList.contains("hidden")).toBe(true);
  });

  it("renders description as text, not HTML", () => {
    const target = document.getElementById("target") as HTMLElement;
    tooltip.attach(target, "<b>bold</b> & <script>alert(1)</script>");
    target.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(300);
    expect(tipEl.innerHTML).not.toContain("<b>");
    expect(tipEl.textContent).toBe("<b>bold</b> & <script>alert(1)</script>");
  });

  it("hides on Escape", () => {
    const target = document.getElementById("target") as HTMLElement;
    tooltip.attach(target, "Desc");
    target.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(300);
    expect(tipEl.classList.contains("hidden")).toBe(false);
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(tipEl.classList.contains("hidden")).toBe(true);
  });

  it("opens on keyboard focus and dismisses on blur", () => {
    const target = document.getElementById("target") as HTMLElement;
    tooltip.attach(target, "Focus description");
    // Focus is a keyboard-accessible activation path, mirroring the tooltip's
    // 'focus' listener used by tab-navigation users.
    target.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(300);
    expect(tipEl.classList.contains("hidden")).toBe(false);
    expect(tipEl.textContent).toBe("Focus description");
    // aria-describedby is wired so assistive tech reads the description.
    expect(target.getAttribute("aria-describedby")).toBe("tooltip");
    target.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(120);
    expect(tipEl.classList.contains("hidden")).toBe(true);
  });

  it("moves aria-describedby when another target is shown", () => {
    const first = document.getElementById("target") as HTMLElement;
    const second = document.createElement("div");
    document.body.appendChild(second);
    tooltip.attach(first, "First");
    tooltip.attach(second, "Second");

    first.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(300);
    expect(first.getAttribute("aria-describedby")).toBe("tooltip");

    second.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(300);
    expect(first.hasAttribute("aria-describedby")).toBe(false);
    expect(second.getAttribute("aria-describedby")).toBe("tooltip");
  });
});
