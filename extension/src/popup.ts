import { NativeClient } from "./native-client.js";
import type { SnippetMeta, CategoryInfo } from "./protocol.js";
import { AppState, initialState } from "./state.js";
import { Tooltip } from "./tooltip.js";
import { writeText } from "./clipboard.js";
import { el, clearChildren, setHidden } from "./dom.js";

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 120;

let state: AppState = initialState();
let generation = 0;
let pendingCopyId: number | null = null;
let client: NativeClient;
let tooltip: Tooltip;

const els = {
  search: null as unknown as HTMLInputElement,
  category: null as unknown as HTMLSelectElement,
  list: null as unknown as HTMLElement,
  status: null as unknown as HTMLElement,
  vaultState: null as unknown as HTMLElement,
  lockBtn: null as unknown as HTMLButtonElement,
  overlay: null as unknown as HTMLElement,
  overlayTitle: null as unknown as HTMLElement,
  overlayMessage: null as unknown as HTMLElement,
  vaultPassword: null as unknown as HTMLInputElement,
  vaultError: null as unknown as HTMLElement,
  vaultCancel: null as unknown as HTMLButtonElement,
  vaultUnlock: null as unknown as HTMLButtonElement,
  tooltipEl: null as unknown as HTMLElement,
};

function setStatus(text: string, isError = false): void {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

function renderCategories(cats: CategoryInfo[]): void {
  const sel = els.category;
  const current = state.category;
  sel.innerHTML = '<option value="">All categories</option>';
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = `${c.name} (${c.count})`;
    sel.appendChild(opt);
  }
  sel.value = current;
}

function renderList(): void {
  clearChildren(els.list);
  tooltip.hideImmediately();
  if (state.items.length === 0) {
    if (state.loading) setStatus("Loading…");
    else if (state.error) setStatus(state.error, true);
    else if (state.query || state.category) setStatus("No matches.");
    else if (state.hostUnavailable) setStatus("CopyIt native host is not installed or registered. See docs/installation.md", true);
    else setStatus(state.total === 0 ? "No prompts yet. Add some in the desktop app." : "");
    return;
  }
  setStatus(`${state.total} prompt${state.total === 1 ? "" : "s"}${state.hasMore ? " — scroll for more" : ""}`);
  for (const item of state.items) {
    const row = el("div", "row");
    row.tabIndex = 0;
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-label", item.title);
    const title = el("div", "row-title", item.title);
    title.style.overflow = "hidden";
    row.appendChild(title);
    if (item.protected) {
      const badge = el("span", "badge-protected", "Protected");
      row.appendChild(badge);
    }
    const btn = el("button", "copy-btn") as HTMLButtonElement;
    btn.type = "button";
    btn.setAttribute("aria-label", `Copy ${item.title}`);
    btn.textContent = "⧉";
    btn.addEventListener("click", () => handleCopy(item.id, btn));
    row.appendChild(btn);
    if (item.description) {
      tooltip.attach(row, item.description);
      tooltip.attach(title, item.description);
    }
    els.list.appendChild(row);
  }
  if (state.hasMore) {
    const more = el("button", "btn") as HTMLButtonElement;
    more.textContent = "Load more";
    more.addEventListener("click", () => loadMore());
    els.list.appendChild(more);
  }
}

async function refreshCategories(): Promise<void> {
  try {
    const res = (await client.request("listCategories")) as { categories: CategoryInfo[] };
    state.categories = res.categories ?? [];
    renderCategories(state.categories);
  } catch {
    // categories are not critical; keep existing
  }
}

async function loadSnippets(reset = true): Promise<void> {
  if (reset) {
    state.items = [];
    state.offset = 0;
    state.hasMore = false;
  }
  const gen = ++generation;
  state.loading = true;
  state.error = null;
  renderList();
  const query = state.query.trim() || undefined;
  const category = state.category || undefined;
  try {
    const res = (await client.request("listSnippets", {
      query,
      category,
      offset: state.offset,
      limit: PAGE_SIZE,
    } as unknown as Record<string, unknown>)) as { items: SnippetMeta[]; total: number; offset: number; pageSize: number; hasMore: boolean };
    if (gen !== generation) return;
    const items: SnippetMeta[] = (res.items ?? []).map((it) => ({
      id: it.id,
      title: String(it.title ?? "").slice(0, 500),
      description: String(it.description ?? "").slice(0, 2000),
      category: String(it.category ?? ""),
      protected: Boolean(it.protected),
    }));
    if (reset) state.items = items;
    else state.items.push(...items);
    state.total = res.total ?? items.length;
    state.hasMore = Boolean(res.hasMore);
    state.offset = (res.offset ?? state.offset) + items.length;
    state.loading = false;
    state.hostUnavailable = false;
  } catch (e) {
    if (gen !== generation) return;
    const err = e as Error & { code?: string };
    state.loading = false;
    if (err.message?.includes("not installed") || err.code === "database_unavailable") {
      state.hostUnavailable = true;
      state.error = err.message;
    } else if (err.code === "unsupported_schema_version") {
      state.error = "Database schema is newer than this extension supports. Update the extension and desktop app.";
    } else if (err.code === "database_busy") {
      state.error = "Database is busy — try again in a moment.";
    } else {
      state.error = err.message || "Failed to load prompts.";
    }
  }
  renderList();
}

function loadMore(): void {
  if (!state.hasMore || state.loading) return;
  loadSnippets(false);
}

let searchTimer: number | null = null;
function onSearchInput(): void {
  state.query = els.search.value;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => loadSnippets(true), SEARCH_DEBOUNCE_MS);
}

function onCategoryChange(): void {
  state.category = els.category.value;
  loadSnippets(true);
}

function showOverlay(title: string, message: string): void {
  els.overlayTitle.textContent = title;
  els.overlayMessage.textContent = message;
  els.vaultError.classList.add("hidden");
  els.vaultError.textContent = "";
  els.vaultPassword.value = "";
  setHidden(els.overlay, false);
  els.vaultPassword.focus();
}

function hideOverlay(): void {
  setHidden(els.overlay, true);
  els.vaultPassword.value = "";
  // Clear password buffer
  els.vaultPassword.value = "";
}

async function handleCopy(id: number, btn: HTMLButtonElement): Promise<void> {
  if (pendingCopyId !== null) return;
  pendingCopyId = id;
  btn.disabled = true;
  const original = btn.textContent;
  try {
    let body: string;
    try {
      const res = (await client.request("getSnippetBody", { id })) as { body: string };
      body = res.body ?? "";
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "vault_locked" || err.message?.includes("vault_locked")) {
        showOverlay("Unlock vault", "Enter password to copy this protected prompt.");
        pendingCopyId = null;
        btn.disabled = false;
        // Remember the pending copy so unlock can retry it
        pendingCopyId = id;
        // Store pending button for retry visual
        (hideOverlay as unknown as { pendingBtn?: HTMLButtonElement }).pendingBtn = btn;
        return;
      }
      throw e;
    }
    await writeText(body);
    // Drop body ref quickly
    body = "";
    btn.textContent = "✓";
    btn.classList.add("copied");
    window.setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove("copied");
      btn.disabled = false;
      pendingCopyId = null;
    }, 850);
  } catch (e) {
    const err = e as Error;
    setStatus(err.message || "Copy failed", true);
    btn.disabled = false;
    pendingCopyId = null;
  }
}

async function handleUnlock(): Promise<void> {
  const password = els.vaultPassword.value;
  if (!password) {
    els.vaultError.textContent = "Password required";
    els.vaultError.classList.remove("hidden");
    return;
  }
  els.vaultUnlock.disabled = true;
  try {
    await client.request("unlockVault", { password });
    // Clear password buffers
    els.vaultPassword.value = "";
    hideOverlay();
    state.vaultState = "unlocked";
    updateVaultUI();
    if (pendingCopyId !== null) {
      const id = pendingCopyId;
      pendingCopyId = null;
      // Retry the copy exactly once
      const btn = document.querySelector(`button[aria-label="Copy ${CSS.escape(String(id))}"]`) as HTMLButtonElement | null;
      // Fallback: just trigger via client; no button animation if not found
      if (btn) await handleCopy(id, btn);
      else {
        const res = (await client.request("getSnippetBody", { id })) as { body: string };
        await writeText(res.body ?? "");
      }
    }
  } catch (e) {
    const err = e as Error & { code?: string };
    els.vaultError.textContent = err.code === "invalid_password" ? "Wrong password. Try again." : err.message || "Unlock failed";
    els.vaultError.classList.remove("hidden");
    els.vaultPassword.focus();
    els.vaultPassword.select();
  } finally {
    els.vaultUnlock.disabled = false;
    // Clear password variable
  }
}

function updateVaultUI(): void {
  const s = state.vaultState;
  if (s === "unlocked") {
    els.vaultState.textContent = "Vault unlocked";
    els.lockBtn.classList.remove("hidden");
  } else if (s === "locked") {
    els.vaultState.textContent = "Vault locked";
    els.lockBtn.classList.add("hidden");
  } else {
    els.vaultState.textContent = "";
    els.lockBtn.classList.add("hidden");
  }
}

async function handleLock(): Promise<void> {
  try {
    await client.request("lockVault");
    state.vaultState = "locked";
    updateVaultUI();
  } catch {}
}

async function init(): Promise<void> {
  els.search = document.getElementById("search") as HTMLInputElement;
  els.category = document.getElementById("category-filter") as HTMLSelectElement;
  els.list = document.getElementById("list") as HTMLElement;
  els.status = document.getElementById("status") as HTMLElement;
  els.vaultState = document.getElementById("vault-state") as HTMLElement;
  els.lockBtn = document.getElementById("lock-vault") as HTMLButtonElement;
  els.overlay = document.getElementById("overlay") as HTMLElement;
  els.overlayTitle = document.getElementById("overlay-title") as HTMLElement;
  els.overlayMessage = document.getElementById("overlay-message") as HTMLElement;
  els.vaultPassword = document.getElementById("vault-password") as HTMLInputElement;
  els.vaultError = document.getElementById("vault-error") as HTMLElement;
  els.vaultCancel = document.getElementById("vault-cancel") as HTMLButtonElement;
  els.vaultUnlock = document.getElementById("vault-unlock") as HTMLButtonElement;
  els.tooltipEl = document.getElementById("tooltip") as HTMLElement;

  tooltip = new Tooltip(els.tooltipEl);
  client = new NativeClient();
  client.onDisconnect((msg) => {
    state.hostUnavailable = true;
    state.error = msg || "Native host disconnected";
    renderList();
  });

  els.search.addEventListener("input", onSearchInput);
  els.category.addEventListener("change", onCategoryChange);
  els.lockBtn.addEventListener("click", handleLock);
  els.vaultCancel.addEventListener("click", () => {
    hideOverlay();
    pendingCopyId = null;
  });
  els.vaultUnlock.addEventListener("click", handleUnlock);
  els.vaultPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleUnlock();
    if (e.key === "Escape") {
      hideOverlay();
      pendingCopyId = null;
    }
  });
  els.overlay.addEventListener("click", (e) => {
    if (e.target === els.overlay) {
      hideOverlay();
      pendingCopyId = null;
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") tooltip.hideImmediately();
  });
  els.list.addEventListener("scroll", () => {
    if (els.list.scrollTop + els.list.clientHeight >= els.list.scrollHeight - 80) loadMore();
  });

  // Autofocus search if possible
  try {
    els.search.focus();
  } catch {}

  // Initial hello + load
  try {
    const hello = (await client.request("hello")) as { vaultState?: string; hostVersion?: string; dbReady?: boolean };
    state.vaultState = (hello.vaultState as typeof state.vaultState) ?? "not_configured";
    state.hostVersion = hello.hostVersion ?? null;
    if (hello.dbReady === false) state.error = "Database not ready — migration required. Restart the desktop app.";
    updateVaultUI();
  } catch (e) {
    const err = e as Error;
    state.hostUnavailable = true;
    state.error = err.message || "Native host unavailable";
    renderList();
    return;
  }
  await refreshCategories();
  await loadSnippets(true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

// Export for tests
export { handleCopy, loadSnippets, setStatus };
