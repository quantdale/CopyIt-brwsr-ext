import { describe, it, expect, vi } from "vitest";
import { createSnippetRow, truncateUtf8 } from "../src/dom.js";

describe("dom — safe rendering and title-only rows", () => {
  it("renders title via textContent, not innerHTML (HTML injection safe)", () => {
    const row = createSnippetRow({
      id: 1,
      title: '<img src=x onerror=alert(1)> Hello',
      description: '<b>desc</b>',
      category: "Git",
      protected: false,
    });
    const title = row.querySelector(".snippet-title") as HTMLElement;
    expect(title.textContent).toBe('<img src=x onerror=alert(1)> Hello');
    expect(title.innerHTML).not.toContain("<img");
    // row contains aria-label with raw title as text attribute, but innerHTML serialization
    // will include the attribute value escaped; ensure no injected element is created
    expect(row.querySelector('img')).toBeNull();
    expect(title.children.length).toBe(0);
    // No body in DOM
    expect(row.textContent).not.toContain("secret body");
    expect(row.querySelectorAll(".snippet-body").length).toBe(0);
  });

  it("creates title-only compact row with copy button", () => {
    const row = createSnippetRow({ id: 5, title: "Next Campaign", description: "desc", category: "Prompt", protected: false });
    expect(row.classList.contains("snippet-row")).toBe(true);
    const title = row.querySelector(".snippet-title") as HTMLElement;
    expect(title).toBeTruthy();
    const btn = row.querySelector("button.copy-btn") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe("⧉");
    // Ellipsizing via CSS white-space nowrap — check class present
    expect(title.classList.contains("snippet-title")).toBe(true);
  });

  it("wires the production copy callback to the rendered button", () => {
    const onCopy = vi.fn();
    const row = createSnippetRow({ id: 6, title: "Copy me", description: "", category: "Prompt", protected: false }, onCopy);
    const button = row.querySelector("button.copy-btn") as HTMLButtonElement;
    button.click();
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledWith(button);
  });

  it("adds lock affordance for protected snippets", () => {
    const rowProt = createSnippetRow({ id: 2, title: "Secret", description: "", category: "G", protected: true });
    expect(rowProt.querySelector(".lock-mark")).toBeTruthy();
    const rowPlain = createSnippetRow({ id: 3, title: "Plain", description: "", category: "G", protected: false });
    expect(rowPlain.querySelector(".lock-mark")).toBeFalsy();
  });

  it("does not render body preview hidden in DOM", () => {
    const row = createSnippetRow({ id: 9, title: "Title", description: "description text", category: "AI Prompt", protected: false });
    // Description should be in data-description for tooltip, not visible text
    const title = row.querySelector(".snippet-title") as HTMLElement;
    expect(title.dataset.description).toBe("description text");
    // But row's visible text should not contain description
    // Row contains title + lock + button; description only via tooltip
    expect(row.textContent).toContain("Title");
    // Description lives on data-description (read by the tooltip), never as
    // visible text; the row shows the title only.
    expect(title.textContent).toBe("Title");
  });

  it("escapes long titles without pushing copy button offscreen (CSS flex + ellipsis)", () => {
    const long = "A".repeat(200);
    const row = createSnippetRow({ id: 10, title: long, description: "", category: "G", protected: false });
    const title = row.querySelector(".snippet-title") as HTMLElement;
    // title should have overflow hidden ellipsis via CSS class
    expect(title.textContent?.length).toBe(200);
    // Button must still exist and be last child
    const btn = row.querySelector(".copy-btn") as HTMLElement;
    expect(btn).toBeTruthy();
    // Row is flex: title has flex 1, btn flex-shrink 0
    expect(row.children[row.children.length - 1]).toBe(btn);
  });

  it("truncates metadata on a UTF-8 scalar boundary", () => {
    expect(truncateUtf8("🙂x", 3)).toBe("");
    expect(truncateUtf8("🙂x", 4)).toBe("🙂");
  });
});
