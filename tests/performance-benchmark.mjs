#!/usr/bin/env node
/**
 * Read-only performance probe for the native host's metadata path.
 *
 * Each fixture is disposable and uses an isolated APPDATA/LOCALAPPDATA. The
 * benchmark reports timings and counts only; it never prints synthetic bodies
 * or other fixture values. Millisecond targets are informational on noisy CI,
 * but setup/protocol failures are hard failures.
 */
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const HOST_EXE = resolve("native-host/target/release/copyit-native-host.exe");
const DIST = resolve("extension/dist");
const EXPECTED_ORIGIN = "chrome-extension://mmiopnfmhmmlmhcdjklelfcdahmgchfc/";
const BODY = "benchmark body ".repeat(80);
const SIZES = [100, 1000, 10000];

const SCHEMA = `
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
);
CREATE TABLE snippets (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    protection_hint TEXT,
    protection_nonce TEXT,
    protection_ciphertext TEXT,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (protection_hint IS NULL AND protection_nonce IS NULL AND protection_ciphertext IS NULL)
      OR
      (protection_hint IS NOT NULL AND protection_nonce IS NOT NULL AND protection_ciphertext IS NOT NULL AND body = '')
    )
);
CREATE INDEX idx_snippets_sort_order ON snippets(sort_order, id);
CREATE INDEX idx_snippets_category ON snippets(category COLLATE NOCASE);
CREATE TABLE categories (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    sort_order INTEGER NOT NULL
);
CREATE TABLE app_config (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    theme TEXT NOT NULL,
    vault_salt TEXT,
    vault_nonce TEXT,
    vault_canary TEXT,
    CHECK (
      (vault_salt IS NULL AND vault_nonce IS NULL AND vault_canary IS NULL)
      OR
      (vault_salt IS NOT NULL AND vault_nonce IS NOT NULL AND vault_canary IS NOT NULL)
    )
);
CREATE TABLE migration_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO schema_migrations VALUES (1, 'initial_schema', '2026-08-28T00:00:00Z');
`;

function writeFixture(root, size) {
  const dataDir = join(root, "CopyIt");
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "copyit.db"));
  db.exec(SCHEMA);
  const category = db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)");
  const insert = db.prepare(`
    INSERT INTO snippets
      (id, title, description, category, body, protection_hint,
       protection_nonce, protection_ciphertext, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
  `);
  db.exec("BEGIN");
  category.run("Benchmark-A", 0);
  category.run("Benchmark-B", 1);
  for (let i = 1; i <= size; i += 1) {
    const title = i === size ? `Needle prompt ${size}` : `Benchmark prompt ${i}`;
    const categoryName = i % 2 === 0 ? "Benchmark-A" : "Benchmark-B";
    insert.run(i, title, `Description ${i}`, categoryName, BODY, i, "2026-08-28T00:00:00Z", "2026-08-28T00:00:00Z");
  }
  db.exec("COMMIT");
  db.close();
  return join(dataDir, "copyit.db");
}

function sendFrame(proc, request) {
  const payload = Buffer.from(JSON.stringify(request), "utf8");
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  proc.stdin.write(frame);
}

function readFrame(proc, timeoutMs = 15000) {
  return new Promise((resolveFrame, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => finish(new Error("native host response timed out")), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.off("data", onData);
      proc.off("error", onError);
      proc.stdout.off("error", onError);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolveFrame(value);
    };
    const onError = (error) => finish(error);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) return;
      try {
        finish(null, JSON.parse(buffer.subarray(4, 4 + length).toString("utf8")));
      } catch (error) {
        finish(error);
      }
    };
    proc.stdout.on("data", onData);
    proc.stdout.once("error", onError);
  });
}

function closeCleanly(proc, timeoutMs = 5000) {
  return new Promise((resolveExit) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      resolveExit(false);
    }, timeoutMs);
    proc.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveExit(code === 0 && signal === null);
    });
    proc.stdin.end();
  });
}

async function benchmarkSize(size) {
  const root = join(tmpdir(), `copyit-performance-${process.pid}-${size}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFixture(root, size);

  const started = performance.now();
  const proc = spawn(HOST_EXE, [EXPECTED_ORIGIN], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, APPDATA: root, LOCALAPPDATA: root },
    windowsHide: true,
  });
  try {
    sendFrame(proc, { protocolVersion: 1, requestId: "benchmark-hello", method: "hello", params: {} });
    const hello = await readFrame(proc);
    if (!hello.ok) throw new Error(`hello failed for ${size} rows`);

    sendFrame(proc, {
      protocolVersion: 1,
      requestId: "benchmark-list",
      method: "listSnippets",
      params: { offset: 0, limit: 100 },
    });
    const firstPage = await readFrame(proc);
    const first100Ms = performance.now() - started;
    if (!firstPage.ok || firstPage.result?.items?.length !== Math.min(100, size)) {
      throw new Error(`first metadata page failed for ${size} rows`);
    }

    const searchStarted = performance.now();
    sendFrame(proc, {
      protocolVersion: 1,
      requestId: "benchmark-search",
      method: "listSnippets",
      params: { query: "Needle", offset: 0, limit: 100 },
    });
    const search = await readFrame(proc);
    const searchMs = performance.now() - searchStarted;
    if (!search.ok || search.result?.items?.length !== 1 || search.result?.items?.[0]?.title !== `Needle prompt ${size}`) {
      throw new Error(`search failed for ${size} rows`);
    }
    if (!(await closeCleanly(proc))) throw new Error(`host did not exit cleanly for ${size} rows`);
    return { size, first100Ms, searchMs, returned: firstPage.result.items.length };
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
    rmSync(root, { recursive: true, force: true });
  }
}

async function benchmarkPopupShell() {
  const popupFile = join(DIST, "popup.html");
  if (!existsSync(popupFile)) throw new Error(`popup build missing at ${popupFile}`);
  const server = createServer(async (request, response) => {
    const relative = (request.url ?? "/popup.html").split("?")[0].replace(/^\/+/, "") || "popup.html";
    const candidate = resolve(DIST, relative);
    if (!candidate.startsWith(DIST)) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    try {
      const content = await readFile(candidate);
      response.writeHead(200);
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("popup benchmark server did not bind");

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 440, height: 560 } });
    const started = performance.now();
    await page.goto(`http://127.0.0.1:${address.port}/popup.html`, { waitUntil: "load", timeout: 15000 });
    await page.locator("#search").waitFor({ state: "visible", timeout: 5000 });
    return performance.now() - started;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolveServer) => server.close(() => resolveServer()));
  }
}

async function main() {
  if (!existsSync(HOST_EXE)) throw new Error(`release host missing at ${HOST_EXE}`);
  const results = [];
  for (const size of SIZES) results.push(await benchmarkSize(size));
  const popupShellMs = await benchmarkPopupShell();

  console.log("COPYIT PERFORMANCE BENCHMARK: PASS");
  console.log("  Fixture: isolated SQLite, long plaintext bodies, no secrets logged");
  console.log(`  Popup shell to visible search control: ${popupShellMs.toFixed(2)}ms`);
  console.log("  Targets: first 100 metadata rows < 1000 ms; title search over 10k < 100 ms (informational)");
  for (const result of results) {
    const firstTarget = result.first100Ms < 1000 ? "met" : "missed";
    const searchTarget = result.size === 10000 ? (result.searchMs < 100 ? "met" : "missed") : "n/a";
    console.log(`  rows=${result.size} returned=${result.returned} first100=${result.first100Ms.toFixed(2)}ms (${firstTarget}) search=${result.searchMs.toFixed(2)}ms (${searchTarget})`);
  }
}

main().catch((error) => {
  console.error(`COPYIT PERFORMANCE BENCHMARK: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
