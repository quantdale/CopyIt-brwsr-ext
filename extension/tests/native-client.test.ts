import { describe, it, expect, vi } from "vitest";
import { NativeClient } from "../src/native-client.js";

type FakePort = chrome.runtime.Port & {
  emitMessage(message: unknown): void;
  fireDisconnect(): void;
  posted(): { requestId: string; method: string };
};

function fakePort(): FakePort {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const postedMessages: Array<{ requestId: string; method: string }> = [];
  return {
    postMessage: vi.fn((message: unknown) => {
      const request = message as { requestId: string; method: string };
      postedMessages.push(request);
    }),
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => messageListeners.push(listener)),
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => disconnectListeners.push(listener)),
    },
    disconnect: vi.fn(),
    emitMessage: (message: unknown) => messageListeners.forEach((listener) => listener(message)),
    fireDisconnect: () => disconnectListeners.forEach((listener) => listener()),
    posted: () => postedMessages[postedMessages.length - 1]!,
  } as unknown as FakePort;
}

function success(requestId: string, result: unknown = { ok: true }): unknown {
  return { protocolVersion: 1, requestId, ok: true, result };
}

describe("NativeClient", () => {
  it("correlates a valid response and resolves", async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port, isAvailable: () => true });
    const pending = client.request("ping", {}, 500);
    port.emitMessage(success(port.posted().requestId));
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("rejects when host unavailable", async () => {
    const client = new NativeClient({ connect: () => null, isAvailable: () => false });
    await expect(client.request("ping")).rejects.toThrow(/not installed/);
  });

  it("reports an incompatible protocol version", async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port, isAvailable: () => true });
    const pending = client.request("ping");
    port.emitMessage({ protocolVersion: 2, requestId: port.posted().requestId, ok: true, result: {} });
    await expect(pending).rejects.toMatchObject({
      code: "unsupported_protocol_version",
      message: "Native host protocol version is incompatible. Reinstall/update CopyIt.",
    });
  });

  it("rejects a response missing requestId", async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port, isAvailable: () => true });
    const pending = client.request("ping");
    port.emitMessage({ protocolVersion: 1, ok: true, result: {} });
    await expect(pending).rejects.toMatchObject({ code: "native_host_internal" });
  });

  it("ignores a valid response for an unknown request ID", async () => {
    vi.useFakeTimers();
    try {
      const port = fakePort();
      const client = new NativeClient({ connect: () => port, isAvailable: () => true });
      const pending = client.request("ping", {}, 25);
      const rejection = expect(pending).rejects.toMatchObject({ code: "native_host_timeout" });
      port.emitMessage(success("unknown-request"));
      await vi.advanceTimersByTimeAsync(25);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed success envelopes", async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port, isAvailable: () => true });
    const pending = client.request("ping");
    port.emitMessage({ protocolVersion: 1, requestId: port.posted().requestId, ok: true });
    await expect(pending).rejects.toMatchObject({ code: "native_host_internal" });
  });

  it("rejects malformed failure envelopes", async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port, isAvailable: () => true });
    const pending = client.request("ping");
    port.emitMessage({
      protocolVersion: 1,
      requestId: port.posted().requestId,
      ok: false,
      error: { code: "database_busy", message: "busy", retryable: "yes" },
    });
    await expect(pending).rejects.toMatchObject({ code: "native_host_internal" });
  });

  it("rejects non-object messages without leaving requests pending", async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port, isAvailable: () => true });
    const pending = client.request("ping");
    port.emitMessage(null);
    await expect(pending).rejects.toMatchObject({ code: "native_host_internal" });
  });

  it("ignores duplicate and late responses after timeout", async () => {
    vi.useFakeTimers();
    try {
      const port = fakePort();
      const client = new NativeClient({ connect: () => port, isAvailable: () => true });
      const pending = client.request("ping", {}, 25);
      const requestId = port.posted().requestId;
      const rejection = expect(pending).rejects.toMatchObject({ code: "native_host_timeout" });
      await vi.advanceTimersByTimeAsync(25);
      await rejection;

      port.emitMessage(success(requestId, { late: true }));
      port.emitMessage(success(requestId, { duplicate: true }));
      expect(client.isConnected()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects every pending request once on disconnect and clears timers", async () => {
    vi.useFakeTimers();
    try {
      const port = fakePort();
      const onDisconnect = vi.fn();
      const client = new NativeClient({ connect: () => port, isAvailable: () => true });
      client.onDisconnect(onDisconnect);
      const first = client.request("ping", {}, 100);
      const second = client.request("ping", {}, 100);
      port.fireDisconnect();
      port.fireDisconnect();
      await expect(first).rejects.toMatchObject({ code: "native_host_disconnected" });
      await expect(second).rejects.toMatchObject({ code: "native_host_disconnected" });
      expect(onDisconnect).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(200);
      expect(client.isConnected()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnects with a fresh port and ignores stale port events", async () => {
    const first = fakePort();
    const second = fakePort();
    let connects = 0;
    const client = new NativeClient({
      connect: () => {
        connects += 1;
        return connects === 1 ? first : second;
      },
      isAvailable: () => true,
    });

    const initial = client.request("ping");
    const initialId = first.posted().requestId;
    first.fireDisconnect();
    await expect(initial).rejects.toMatchObject({ code: "native_host_disconnected" });

    const reconnected = client.request("ping", {}, 500);
    const reconnectedId = second.posted().requestId;
    first.emitMessage(success(reconnectedId, { stale: true }));
    second.emitMessage(success(reconnectedId, { fresh: true }));
    await expect(reconnected).resolves.toEqual({ fresh: true });
    expect(initialId).not.toBe(reconnectedId);
    expect(connects).toBe(2);

    first.fireDisconnect();
    expect(client.isConnected()).toBe(true);
  });

  it("cleans pending requests when the popup explicitly disconnects", async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port, isAvailable: () => true });
    const pending = client.request("ping", {}, 500);
    client.disconnect();
    await expect(pending).rejects.toMatchObject({ code: "native_host_disconnected" });
    expect(client.isConnected()).toBe(false);
    expect(port.disconnect).toHaveBeenCalledOnce();
  });

  it("surfaces a native failure code and retryability", async () => {
    const port = fakePort();
    const client = new NativeClient({ connect: () => port, isAvailable: () => true });
    const pending = client.request("getSnippetBody", { id: 2 });
    port.emitMessage({
      protocolVersion: 1,
      requestId: port.posted().requestId,
      ok: false,
      error: { code: "database_busy", message: "Database is busy", retryable: true },
    });
    await expect(pending).rejects.toMatchObject({
      code: "database_busy",
      message: "Database is busy",
      retryable: true,
    });
  });
});
