import type { RequestEnvelope, ResponseEnvelope, Method } from "./protocol.js";
import { nextRequestId } from "./protocol.js";

export type Transport = {
  connect(): chrome.runtime.Port | null;
  isAvailable(): boolean;
};

export type Pending<T = unknown> = {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  timer?: number;
};

const HOST_NAME = "com.quantdale.copyit";
const DEFAULT_TIMEOUT_MS = 3500;

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
    const p = this.transport.connect();
    if (!p) return false;
    this.port = p;
    this.connected = true;
    p.onMessage.addListener((msg: unknown) => this.handleMessage(msg as ResponseEnvelope));
    p.onDisconnect.addListener(() => {
      this.connected = false;
      const err = chrome.runtime.lastError?.message ?? "Native host disconnected";
      for (const [, pending] of this.pending) {
        pending.reject(new Error(err));
        if (pending.timer) clearTimeout(pending.timer);
      }
      this.pending.clear();
      this.port = null;
      this.onDisconnectCb?.(err);
    });
    return true;
  }

  private handleMessage(msg: ResponseEnvelope): void {
    const id = (msg as { requestId?: string }).requestId;
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    if ((msg as { ok: boolean }).ok) {
      pending.resolve((msg as { result: unknown }).result);
    } else {
      const err = (msg as { error: { code: string; message: string } }).error;
      const e = new Error(err.message || err.code) as Error & { code?: string; retryable?: boolean };
      e.code = err.code;
      (e as unknown as { retryable?: boolean }).retryable = (msg as { error: { retryable?: boolean } }).error.retryable;
      pending.reject(e);
    }
  }

  request<T = unknown>(method: Method, params?: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (!this.ensureConnected() || !this.port) {
      return Promise.reject(new Error("CopyIt native host is not installed or registered."));
    }
    const requestId = nextRequestId();
    const envelope: RequestEnvelope = { protocolVersion: 1, requestId, method, params: params ?? {} };
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Native host timed out"));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      try {
        this.port!.postMessage(envelope);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  disconnect(): void {
    try {
      this.port?.disconnect();
    } catch {}
    this.port = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
