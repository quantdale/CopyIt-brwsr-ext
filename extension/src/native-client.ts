import type { RequestEnvelope, Method } from "./protocol.js";
import { nextRequestId, validateResponseEnvelope } from "./protocol.js";

export type Transport = {
  connect(): chrome.runtime.Port | null;
  isAvailable(): boolean;
};

export type Pending<T = unknown> = {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  timer: number;
};

type NativeError = Error & { code?: string; retryable?: boolean };

const HOST_NAME = "com.quantdale.copyit";
export const DEFAULT_TIMEOUT_MS = 3500;
/** Argon2id plus bounded failure backoff gets a wider budget than reads. */
export const UNLOCK_TIMEOUT_MS = 10_000;

function nativeError(message: string, code?: string, retryable?: boolean): NativeError {
  const error = new Error(message) as NativeError;
  if (code !== undefined) error.code = code;
  if (retryable !== undefined) error.retryable = retryable;
  return error;
}

export class NativeClient {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<string, Pending>();
  private transport: Transport;
  private connected = false;
  private onDisconnectCb: ((msg: string) => void) | null = null;

  constructor(transport?: Transport) {
    this.transport = transport ?? {
      connect: () => {
        try {
          return chrome.runtime.connectNative(HOST_NAME);
        } catch {
          return null;
        }
      },
      isAvailable: () => typeof chrome !== "undefined" && !!chrome.runtime?.connectNative,
    };
  }

  onDisconnect(cb: (msg: string) => void): void {
    this.onDisconnectCb = cb;
  }

  ensureConnected(): boolean {
    if (this.connected && this.port) return true;
    if (!this.transport.isAvailable()) return false;
    let connectedPort: chrome.runtime.Port | null = null;
    try {
      connectedPort = this.transport.connect();
    } catch {
      return false;
    }
    if (!connectedPort) return false;
    const port = connectedPort;
    this.port = port;
    this.connected = true;
    port.onMessage.addListener((msg: unknown) => this.handleMessage(port, msg));
    port.onDisconnect.addListener(() => this.handleDisconnect(port));
    return true;
  }

  private clearTimer(pending: Pending): void {
    clearTimeout(pending.timer);
  }

  private takePending(requestId: string): Pending | undefined {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;
    this.pending.delete(requestId);
    this.clearTimer(pending);
    return pending;
  }

  private rejectAllPending(error: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const item of pending) {
      this.clearTimer(item);
      item.reject(error);
    }
  }

  private handleDisconnect(source: chrome.runtime.Port): void {
    if (this.port !== source) return;
    this.port = null;
    this.connected = false;
    const runtimeError = typeof chrome !== "undefined" ? chrome.runtime?.lastError?.message : undefined;
    const message = typeof runtimeError === "string" && runtimeError.length > 0
      ? runtimeError
      : "Native host disconnected";
    this.rejectAllPending(nativeError(message, "native_host_disconnected"));
    this.onDisconnectCb?.(message);
  }

  private handleMessage(source: chrome.runtime.Port, msg: unknown): void {
    if (this.port !== source) return;
    const validation = validateResponseEnvelope(msg);
    if (!validation.valid) {
      const error = nativeError(validation.message, validation.code);
      if (validation.requestId) {
        const pending = this.takePending(validation.requestId);
        if (pending) pending.reject(error);
      } else {
        this.rejectAllPending(error);
      }
      return;
    }

    const pending = this.takePending(validation.response.requestId);
    if (!pending) return;
    if (validation.response.ok) {
      pending.resolve(validation.response.result);
      return;
    }
    const responseError = nativeError(
      validation.response.error.message || validation.response.error.code,
      validation.response.error.code,
      validation.response.error.retryable,
    );
    pending.reject(responseError);
  }

  request<T = unknown>(
    method: Method,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.ensureConnected() || !this.port) {
      return Promise.reject(new Error("CopyIt native host is not installed or registered."));
    }
    const requestId = nextRequestId();
    if (this.pending.has(requestId)) {
      return Promise.reject(new Error("Duplicate native request ID"));
    }
    const port = this.port;
    const envelope: RequestEnvelope = { protocolVersion: 1, requestId, method, params: params ?? {} };
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.reject(nativeError("Native host timed out", "native_host_timeout"));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        port.postMessage(envelope);
      } catch (error) {
        const pending = this.takePending(requestId);
        if (pending) pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  disconnect(): void {
    const port = this.port;
    this.port = null;
    this.connected = false;
    this.rejectAllPending(nativeError("Native host disconnected", "native_host_disconnected"));
    try {
      port?.disconnect();
    } catch {
      // Teardown: ignore errors from an already-closed port.
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
