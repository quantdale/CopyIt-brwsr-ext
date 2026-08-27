#!/usr/bin/env node
/**
 * Failure States Certification Test
 * =================================
 * Exercises failure states against the real native host and protocol parser:
 * 1. Host rejected on invalid origin argument
 * 2. Host handles future unsupported schema version cleanly
 * 3. Oversized framing rejection
 */
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HOST_EXE = resolve("native-host/target/release/copyit-native-host.exe");
const EXPECTED_ORIGIN = "chrome-extension://mmiopnfmhmmlmhcdjklelfcdahmgchfc/";

const results = { pass: 0, fail: 0, details: [] };
function pass(n) { results.pass++; results.details.push({ name: n, status: "PASS" }); console.log(`  ✓ PASS: ${n}`); }
function fail(n, r) { results.fail++; results.details.push({ name: n, status: "FAIL", reason: r }); console.error(`  ✗ FAIL: ${n} — ${r}`); }

function sendMessage(proc, obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(buf.length, 0);
  proc.stdin.write(lenBuf);
  proc.stdin.write(buf);
}

function readResponse(proc, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    let headerBuf = Buffer.alloc(0);
    let bodyBuf = Buffer.alloc(0);
    let expectedLen = null;

    const onData = (chunk) => {
      if (expectedLen === null) {
        headerBuf = Buffer.concat([headerBuf, chunk]);
        if (headerBuf.length >= 4) {
          expectedLen = headerBuf.readUInt32LE(0);
          bodyBuf = headerBuf.slice(4);
          headerBuf = Buffer.alloc(0);
        }
      } else {
        bodyBuf = Buffer.concat([bodyBuf, chunk]);
      }

      if (expectedLen !== null && bodyBuf.length >= expectedLen) {
        clearTimeout(timer);
        proc.stdout.removeListener("data", onData);
        const json = bodyBuf.slice(0, expectedLen).toString("utf8");
        resolve(JSON.parse(json));
      }
    };

    proc.stdout.on("data", onData);
  });
}

function waitForExit(proc, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    proc.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal });
    });
    proc.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, signal: null, error });
    });
  });
}

async function main() {
  console.log("=== Testing Native Host Failure States ===");

  // 1. Wrong origin argument
  console.log("\n--- 1. Wrong origin argument ---");
  const badProc = spawn(HOST_EXE, ["chrome-extension://unauthorized_ext_id/"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  badProc.stdin.end();
  const badOriginOutcome = await waitForExit(badProc, 3000);
  if (badOriginOutcome?.code === 2 && badOriginOutcome.signal === null) {
    pass("failure:wrong-origin-rejected — process exited with code 2 immediately");
  } else if (badOriginOutcome === null) {
    fail("failure:wrong-origin-rejected", "host remained alive past the bounded rejection timeout");
    badProc.kill();
  } else {
    fail("failure:wrong-origin-rejected", `unexpected exit outcome: ${JSON.stringify(badOriginOutcome)}`);
  }

  // 2. Future schema rejection
  console.log("\n--- 2. Unsupported future schema version ---");
  const testDir = mkdtempSync(join(tmpdir(), "copyit-schema-test-"));
  const copyitAppDir = join(testDir, "CopyIt");
  mkdirSync(copyitAppDir, { recursive: true });
  const futureDbPath = join(copyitAppDir, "copyit.db");
  const db = new DatabaseSync(futureDbPath);
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);
    INSERT INTO schema_migrations VALUES (999, 'future_schema_v999', '2026-08-27T00:00:00Z');
    CREATE TABLE snippets (id INTEGER PRIMARY KEY, title TEXT, category TEXT, body TEXT, sort_order INTEGER, created_at TEXT, updated_at TEXT);
  `);
  db.close();

  // Launch host pointing to custom APPDATA with future schema DB
  const futureProc = spawn(HOST_EXE, [EXPECTED_ORIGIN], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, APPDATA: testDir },
  });

  sendMessage(futureProc, { protocolVersion: 1, requestId: "fut-1", method: "hello", params: {} });
  try {
    const resHello = await readResponse(futureProc);
    if (resHello.ok && resHello.result?.dbReady === false && resHello.result?.lastErrorCode === "unsupported_schema_version") {
      pass("failure:hello-unsupported-schema — hello reported dbReady=false and lastErrorCode=unsupported_schema_version");
    } else {
      fail("failure:hello-unsupported-schema", JSON.stringify(resHello));
    }

    // Now call listSnippets, which must return ok: false with code: unsupported_schema_version
    sendMessage(futureProc, { protocolVersion: 1, requestId: "fut-2", method: "listSnippets", params: {} });
    const resList = await readResponse(futureProc);
    if (!resList.ok && resList.error?.code === "unsupported_schema_version") {
      pass("failure:listSnippets-unsupported-schema — listSnippets refused query with unsupported_schema_version error code");
    } else {
      fail("failure:listSnippets-unsupported-schema", JSON.stringify(resList));
    }
  } catch (e) {
    fail("failure:unsupported-schema", e.message);
  }
  futureProc.stdin.end();
  const futureOutcome = await waitForExit(futureProc);
  if (futureOutcome === null) futureProc.kill();

  // 3. Oversized framing rejection
  console.log("\n--- 3. Oversized framing rejection ---");
  const normalProc = spawn(HOST_EXE, [EXPECTED_ORIGIN], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, APPDATA: testDir },
  });
  
  const bigLenBuf = Buffer.alloc(4);
  bigLenBuf.writeUInt32LE(50 * 1024 * 1024, 0);
  normalProc.stdin.write(bigLenBuf);

  // Closing stdin makes the malformed frame a complete subprocess test: a
  // conforming host must reject the prefix and terminate without waiting for
  // a 50 MB payload. A test-side kill is never a PASS condition.
  normalProc.stdin.end();
  const oversizedOutcome = await waitForExit(normalProc);
  if (oversizedOutcome?.code === 1 && oversizedOutcome.signal === null) {
    pass("failure:oversized-framing-rejected — host terminated with protocol-violation status 1");
  } else if (oversizedOutcome === null) {
    fail("failure:oversized-framing-rejected", "host remained alive past the bounded rejection timeout");
    normalProc.kill();
  } else {
    fail("failure:oversized-framing-rejected", `unexpected exit outcome: ${JSON.stringify(oversizedOutcome)}`);
  }

  rmSync(testDir, { recursive: true, force: true });

  console.log(`\nFailure States Results: PASS: ${results.pass}, FAIL: ${results.fail}`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch(console.error);
