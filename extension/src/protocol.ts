export type RequestId = string;

export type Method =
  | "hello"
  | "listCategories"
  | "listSnippets"
  | "getSnippetBody"
  | "unlockVault"
  | "lockVault"
  | "ping";

export type ErrorCode =
  | "invalid_request"
  | "unsupported_protocol_version"
  | "unknown_method"
  | "invalid_params"
  | "native_host_internal"
  | "migration_in_progress"
  | "migration_failed"
  | "legacy_data_corrupt"
  | "database_unavailable"
  | "database_busy"
  | "unsupported_schema_version"
  | "not_found"
  | "vault_not_configured"
  | "vault_locked"
  | "invalid_password"
  | "decrypt_failed"
  | "response_too_large";

export interface RequestEnvelope {
  protocolVersion: 1;
  requestId: string;
  method: Method;
  params?: Record<string, unknown>;
}

export interface SuccessEnvelope<T = unknown> {
  protocolVersion: 1;
  requestId: string;
  ok: true;
  result: T;
}

export interface FailureEnvelope {
  protocolVersion: 1;
  requestId: string;
  ok: false;
  error: { code: ErrorCode; message: string; retryable: boolean };
}

export type ResponseEnvelope<T = unknown> = SuccessEnvelope<T> | FailureEnvelope;

export interface HelloResult {
  protocolVersion: 1;
  hostVersion: string;
  supportedSchemaVersion: number;
  dbSchemaVersion: number | null;
  vaultState: "locked" | "unlocked" | "not_configured";
  migrationStatus: string;
  dbReady: boolean;
  lastErrorCode?: string | null;
}

export interface CategoryInfo {
  name: string;
  count: number;
}

export interface SnippetMeta {
  id: number;
  title: string;
  description: string;
  category: string;
  protected: boolean;
}

export interface ListSnippetsParams {
  query?: string;
  category?: string;
  offset?: number;
  limit?: number;
}

export interface ListSnippetsResult {
  items: SnippetMeta[];
  total: number;
  offset: number;
  pageSize: number;
  hasMore: boolean;
}

export function isFailure<T>(r: ResponseEnvelope<T>): r is FailureEnvelope {
  return r.ok === false;
}

let counter = 0;
export function nextRequestId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
