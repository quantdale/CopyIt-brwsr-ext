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

export interface SnippetRowData {
  id: number;
  title: string;
  description: string;
  category: string;
  protected: boolean;
}

export function createSnippetRow(data: SnippetRowData): HTMLElement {
  const row = el("div", "snippet-row");
  row.classList.add("row");
  row.setAttribute("role", "listitem");
  const title = el("div", "snippet-title", data.title);
  title.dataset.description = data.description;
  row.appendChild(title);
  if (data.protected) {
    const lock = el("span", "lock-mark", "🔒");
    lock.setAttribute("aria-label", "protected");
    row.appendChild(lock);
  }
  const btn = el("button", "copy-btn") as HTMLButtonElement;
  btn.type = "button";
  btn.textContent = "⧉";
  btn.setAttribute("aria-label", `Copy ${data.title}`);
  row.appendChild(btn);
  return row;
}
