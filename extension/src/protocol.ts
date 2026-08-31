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

type ResponseValidationFailure = {
  valid: false;
  requestId?: string;
  code: "native_host_internal" | "unsupported_protocol_version";
  message: string;
};

export type ResponseValidation =
  | { valid: true; response: ResponseEnvelope }
  | ResponseValidationFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function malformedResponse(requestId?: string): ResponseValidationFailure {
  return {
    valid: false,
    requestId,
    code: "native_host_internal",
    message: "Native host returned a malformed response.",
  };
}

/** Validates the small, stable response envelope at the browser boundary. */
export function validateResponseEnvelope(msg: unknown): ResponseValidation {
  if (!isRecord(msg)) return malformedResponse();

  const requestId = isValidRequestId(msg.requestId) ? msg.requestId : undefined;
  if (msg.protocolVersion !== 1) {
    return {
      valid: false,
      requestId,
      code: "unsupported_protocol_version",
      message: "Native host protocol version is incompatible. Reinstall/update CopyIt.",
    };
  }
  if (!requestId || typeof msg.ok !== "boolean") return malformedResponse(requestId);

  if (msg.ok) {
    if (!Object.prototype.hasOwnProperty.call(msg, "result") || msg.result === undefined || "error" in msg) {
      return malformedResponse(requestId);
    }
    return {
      valid: true,
      response: {
        protocolVersion: 1,
        requestId,
        ok: true,
        result: msg.result,
      },
    };
  }

  if ("result" in msg || !isRecord(msg.error)) return malformedResponse(requestId);
  const error = msg.error;
  if (
    typeof error.code !== "string"
    || error.code.length === 0
    || typeof error.message !== "string"
    || typeof error.retryable !== "boolean"
  ) {
    return malformedResponse(requestId);
  }
  return {
    valid: true,
    response: {
      protocolVersion: 1,
      requestId,
      ok: false,
      error: {
        code: error.code as ErrorCode,
        message: error.message,
        retryable: error.retryable,
      },
    },
  };
}

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
