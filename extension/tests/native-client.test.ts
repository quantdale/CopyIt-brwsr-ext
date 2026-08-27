import { describe, it, expect, vi } from "vitest";
import { NativeClient } from "../src/native-client.js";

type FakePort = chrome.runtime.Port & { fireDisconnect(): void };

function fakePort(): FakePort {
  const listeners: Record<string, ((msg: unknown) => void)[]> = {};
  const disconnectListeners: (() => void)[] = [];
  return {
    postMessage: vi.fn((msg: unknown) => {
      const m = msg as { requestId: string; method: string };
      // echo success
      setTimeout(() => {
        for (const cb of listeners["message"] ?? []) cb({ protocolVersion: 1, requestId: m.requestId, ok: true, result: { ok: true } });
      }, 0);
    }),
    onMessage: {
      addListener: vi.fn((cb: (msg: unknown) => void) => {
        listeners["message"] ??= [];
        listeners["message"].push(cb);
      }),
    },
    onDisconnect: {
      addListener: vi.fn((cb: () => void) => disconnectListeners.push(cb)),
    },
    disconnect: vi.fn(),
    fireDisconnect: () => disconnectListeners.forEach((cb) => cb()),
  } as unknown as FakePort;
}

describe("NativeClient", () => {
  it("correlates requestId and resolves", async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port, isAvailable: () => true });
    const p = client.request("ping", {}, 500);
    await expect(p).resolves.toEqual({ ok: true });
  });

  it("rejects when host unavailable", async () => {
    const client = new NativeClient({ connect: () => null, isAvailable: () => false });
    await expect(client.request("ping")).rejects.toThrow(/not installed/);
  });

  it("rejects pending requests on disconnect and reconnects on the next request", async () => {
    let port: FakePort | null = null;
    let connects = 0;
    const client = new NativeClient({
      connect: () => {
        connects += 1;
        port = fakePort();
        return port;
      },
      isAvailable: () => true,
    });
    const pending = client.request("ping", {}, 5000);
    port!.fireDisconnect();
    await expect(pending).rejects.toThrow("Native host disconnected");
    expect(client.isConnected()).toBe(false);

    await expect(client.request("ping")).resolves.toEqual({ ok: true });
    expect(connects).toBe(2);
  });

  it("surfaces the error code from a failure envelope", async () => {
    // A native host failure frame must reject with a copyable Error carrying the
    // stable protocol `code` and human-readable `message` (used by the vault UI).
    const listeners: Array<(msg: unknown) => void> = [];
    const failPort: chrome.runtime.Port = {
      postMessage: vi.fn((msg: unknown) => {
        const requestId = (msg as { requestId?: string }).requestId;
        setTimeout(() => {
          for (const cb of listeners) {
            cb({
              protocolVersion: 1,
              requestId,
              ok: false,
              error: { code: "vault_locked", message: "Vault is locked", retryable: false },
            });
          }
        }, 0);
      }),
      onMessage: { addListener: vi.fn((cb: (msg: unknown) => void) => listeners.push(cb)) },
      onDisconnect: { addListener: vi.fn() },
      disconnect: vi.fn(),
    } as unknown as chrome.runtime.Port;

    const client = new NativeClient({ connect: () => failPort, isAvailable: () => true });
    await expect(client.request("getSnippetBody", { id: 2 })).rejects.toMatchObject({
      code: "vault_locked",
      message: "Vault is locked",
    });
  });
});
