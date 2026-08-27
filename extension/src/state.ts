import type { SnippetMeta, CategoryInfo } from "./protocol.js";

export type VaultState = "locked" | "unlocked" | "not_configured";

export interface AppState {
  query: string;
  category: string;
  categories: CategoryInfo[];
  items: SnippetMeta[];
  total: number;
  offset: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  vaultState: VaultState;
  hostUnavailable: boolean;
  hostVersion: string | null;
}

export function initialState(): AppState {
  return {
    query: "",
    category: "",
    categories: [],
    items: [],
    total: 0,
    offset: 0,
    hasMore: false,
    loading: false,
    error: null,
    vaultState: "not_configured",
    hostUnavailable: false,
    hostVersion: null,
  };
}

export function shouldDiscardResponse(generation: number, current: number): boolean {
  return generation !== current;
}
