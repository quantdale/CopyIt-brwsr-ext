export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function clearChildren(parent: HTMLElement): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
}

export function setHidden(e: HTMLElement, hidden: boolean): void {
  e.classList.toggle("hidden", hidden);
  e.setAttribute("aria-hidden", hidden ? "true" : "false");
}

/** Truncates at a UTF-8 byte boundary without splitting a Unicode scalar. */
export function truncateUtf8(value: string, maxBytes: number): string {
  if (value.length === 0 || maxBytes <= 0) return "";
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;

  let bytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = encoder.encode(character).length;
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

export interface SnippetRowData {
  id: number;
  title: string;
  description: string;
  category: string;
  protected: boolean;
}

export function createSnippetRow(
  data: SnippetRowData,
  onCopy?: (button: HTMLButtonElement) => void,
): HTMLElement {
  const row = el("div", "row snippet-row");
  row.tabIndex = 0;
  row.setAttribute("role", "listitem");
  row.setAttribute("aria-label", data.title);
  const title = el("div", "row-title snippet-title", data.title);
  if (data.description) title.dataset.description = data.description;
  row.appendChild(title);
  if (data.protected) {
    const lock = el("span", "badge-protected lock-mark", "Protected");
    lock.setAttribute("aria-label", "Protected prompt");
    row.appendChild(lock);
  }
  const btn = el("button", "copy-btn") as HTMLButtonElement;
  btn.type = "button";
  btn.textContent = "⧉";
  btn.setAttribute("aria-label", `Copy ${data.title}`);
  if (onCopy) btn.addEventListener("click", () => onCopy(btn));
  row.appendChild(btn);
  return row;
}
