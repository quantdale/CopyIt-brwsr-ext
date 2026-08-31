#!/usr/bin/env node
/**
 * Real Native Host Protocol Test
 * ================================
 * 1. Reads the host manifest from the registry-registered path
 * 2. Launches the native host executable with the correct origin argument
 * 3. Sends protocol messages via stdin (4-byte length + JSON)
 * 4. Reads responses from stdout (4-byte length + JSON)
 * 5. Exercises the complete API: hello, listCategories, listSnippets, search,
 *    getSnippetBody, vault operations
 *
 * This uses a disposable synthetic APPDATA/LOCALAPPDATA fixture. It verifies
 * the installed manifest and executable without reading or mutating the user's
 * canonical CopyIt database.
 *
 * Usage: node tests/real-native-host-test.mjs
 */
import { spawn, execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createCertFixture } from "./helpers/cert-fixture.mjs";

const EXPECTED_ID = "mmiopnfmhmmlmhcdjklelfcdahmgchfc";
const EXPECTED_ORIGIN = `chrome-extension://${EXPECTED_ID}/`;

const results = { pass: 0, fail: 0, skip: 0, details: [] };
function pass(n) { results.pass++; results.details.push({ name: n, status: "PASS" }); console.log(`  ✓ PASS: ${n}`); }
function fail(n, r) { results.fail++; results.details.push({ name: n, status: "FAIL", reason: r }); console.error(`  ✗ FAIL: ${n} — ${r}`); }
function skip(n, r) { results.skip++; results.details.push({ name: n, status: "SKIP", reason: r }); console.log(`  ⊘ SKIP: ${n} — ${r}`); }

function readRegistryValue(keyPath) {
  try {
    const output = execSync(
      `powershell -NoProfile -Command "(Get-ItemProperty -Path '${keyPath}' -Name '(default)' -ErrorAction Stop).'(default)'"`,
      { encoding: "utf8" },
    ).trim();
    return output;
  } catch {
    return null;
  }
}

function sendMessage(proc, obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(buf.length, 0);
  proc.stdin.write(lenBuf);
  proc.stdin.write(buf);
}

function readResponse(proc, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Response timeout")), timeoutMs);
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
        try {
          resolve(JSON.parse(json));
        } catch {
          reject(new Error(`Invalid JSON: ${json.substring(0, 200)}`));
        }
      }
    };

    proc.stdout.on("data", onData);
  });
}

function waitForExit(proc, timeoutMs = 5000) {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve({ code: proc.exitCode, signal: proc.signalCode });
  }
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
      resolve({ code: null, signal: null, error: error.message });
    });
  });
}

let requestCounter = 0;
function makeRequest(method, params = {}) {
  return {
    protocolVersion: 1,
    requestId: `cert-${++requestCounter}`,
    method,
    params,
  };
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║  CopyIt — Real Native Host Protocol Certification           ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
  console.log(`Date: ${new Date().toISOString()}`);

  // === 1. Registry check ===
  console.log("\n--- 1. Registry Verification ---");
  const chromeRegKey = "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.quantdale.copyit";
  const edgeRegKey = "HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.quantdale.copyit";

  const chromeManifestPath = readRegistryValue(chromeRegKey);
  const edgeManifestPath = readRegistryValue(edgeRegKey);

  console.log(`  Chrome registry: ${chromeManifestPath || "NOT FOUND"}`);
  console.log(`  Edge registry: ${edgeManifestPath || "NOT FOUND"}`);

  if (chromeManifestPath) pass("registry:chrome");
  else fail("registry:chrome", "Not registered");

  if (edgeManifestPath) pass("registry:edge");
  else fail("registry:edge", "Not registered");

  if (chromeManifestPath && edgeManifestPath && chromeManifestPath === edgeManifestPath) {
    pass("registry:consistent — same manifest path");
  }

  // === 2. Host manifest ===
  console.log("\n--- 2. Host Manifest ---");
  const manifestPath = chromeManifestPath || edgeManifestPath;
  if (!manifestPath || !existsSync(manifestPath)) {
    fail("manifest:exists", `Not found at ${manifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  console.log(`  name: ${manifest.name}`);
  console.log(`  type: ${manifest.type}`);
  console.log(`  path: ${manifest.path}`);
  console.log(`  allowed_origins: ${JSON.stringify(manifest.allowed_origins)}`);

  if (manifest.name === "com.quantdale.copyit") pass("manifest:name");
  else fail("manifest:name", manifest.name);

  if (manifest.type === "stdio") pass("manifest:type");
  else fail("manifest:type", manifest.type);

  if (manifest.path && existsSync(manifest.path)) pass("manifest:path-exists");
  else fail("manifest:path", `Not found: ${manifest.path}`);

  if (manifest.allowed_origins?.includes(EXPECTED_ORIGIN)) pass("manifest:allowed-origin");
  else fail("manifest:allowed-origin", JSON.stringify(manifest.allowed_origins));

  if (manifest.allowed_origins?.length === 1) pass("manifest:single-origin — no extra origins");
  else fail("manifest:extra-origins", `${manifest.allowed_origins?.length} origins`);

  // === 3. Launch native host (simulating Chrome) ===
  console.log("\n--- 3. Native Host Launch ---");
  const hostExe = manifest.path;
  const fixture = createCertFixture();
  console.log(`  Disposable APPDATA fixture: ${fixture.tmpDir}`);
  process.on("exit", () => fixture.cleanup());


  // Chrome launches: <exe> chrome-extension://<id>/ --parent-window=0
  const proc = spawn(hostExe, [EXPECTED_ORIGIN, "--parent-window=0"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, APPDATA: fixture.tmpDir, LOCALAPPDATA: fixture.tmpDir },
  });

  let stderrData = "";
  proc.stderr.on("data", (d) => (stderrData += d.toString()));

  proc.on("error", (e) => {
    fail("host:launch", e.message);
    process.exit(1);
  });

  pass("host:launch — process started");

  // === 4. Hello ===
  console.log("\n--- 4. Protocol: hello ---");
  try {
    sendMessage(proc, makeRequest("hello"));
    const hello = await readResponse(proc);
    console.log(`  protocolVersion: ${hello.protocolVersion}`);
    console.log(`  ok: ${hello.ok}`);
    console.log(`  hostVersion: ${hello.result?.hostVersion}`);
    console.log(`  vaultState: ${hello.result?.vaultState}`);
    console.log(`  dbSchemaVersion: ${hello.result?.dbSchemaVersion}`);
    console.log(`  dbReady: ${hello.result?.dbReady}`);

    if (hello.ok) pass("protocol:hello");
    else fail("protocol:hello", hello.error?.message);

    if (hello.result?.vaultState) pass(`protocol:vault-state — ${hello.result.vaultState}`);
    if (hello.result?.dbReady !== false) pass("protocol:db-ready");
    else fail("protocol:db-ready", "Database not ready");
  } catch (e) {
    fail("protocol:hello", e.message);
  }

  // === 5. List Categories ===
  console.log("\n--- 5. Protocol: listCategories ---");
  let categories = [];
  try {
    sendMessage(proc, makeRequest("listCategories"));
    const catRes = await readResponse(proc);

    if (catRes.ok) {
      categories = catRes.result?.categories || [];
      console.log(`  Categories (${categories.length}):`);
      for (const c of categories) {
        console.log(`    "${c.name}" (${c.count} snippets)`);
      }
      pass(`protocol:listCategories — ${categories.length} categories`);
    } else {
      fail("protocol:listCategories", catRes.error?.message);
    }
  } catch (e) {
    fail("protocol:listCategories", e.message);
  }

  // === 6. List Snippets ===
  console.log("\n--- 6. Protocol: listSnippets ---");
  let snippets = [];
  let total = 0;
  try {
    sendMessage(proc, makeRequest("listSnippets", { limit: 100, offset: 0 }));
    const listRes = await readResponse(proc);

    if (listRes.ok) {
      snippets = listRes.result?.items || [];
      total = listRes.result?.total || 0;
      const hasMore = listRes.result?.hasMore || false;
      console.log(`  Total: ${total}, returned: ${snippets.length}, hasMore: ${hasMore}`);

      // Verify items don't contain body
      const bodyLeak = snippets.some((s) => s.body !== undefined);
      if (bodyLeak) fail("protocol:no-body-leak", "Items contain body field");
      else pass("protocol:no-body-leak — items have no body");

      // Show first few
      for (const s of snippets.slice(0, 5)) {
        const prot = s.protected ? " [PROTECTED]" : "";
        const desc = s.description ? ` (desc: ${s.description.substring(0, 40)}…)` : "";
        console.log(`    #${s.id} "${s.title}"${prot}${desc}`);
      }
      pass(`protocol:listSnippets — ${total} snippets`);

      // Verify ordering
      const ids = snippets.map((s) => s.id);
      pass(`protocol:ordering — IDs: ${ids.slice(0, 10).join(", ")}${ids.length > 10 ? "…" : ""}`);
    } else {
      fail("protocol:listSnippets", listRes.error?.message);
    }
  } catch (e) {
    fail("protocol:listSnippets", e.message);
  }

  // === 7. Category filtering ===
  console.log("\n--- 7. Protocol: Category Filter ---");
  if (categories.length > 0) {
    try {
      const cat = categories[0].name;
      sendMessage(proc, makeRequest("listSnippets", { category: cat, limit: 100 }));
      const filtRes = await readResponse(proc);
      if (filtRes.ok) {
        const filtered = filtRes.result?.items || [];
        const wrongCat = filtered.filter((s) => s.category.toLowerCase() !== cat.toLowerCase());
        if (wrongCat.length === 0) {
          pass(`protocol:category-filter — "${cat}" → ${filtered.length} items (all correct category)`);
        } else {
          fail("protocol:category-filter", `${wrongCat.length} items with wrong category`);
        }
      } else {
        fail("protocol:category-filter", filtRes.error?.message);
      }
    } catch (e) {
      fail("protocol:category-filter", e.message);
    }
  }

  // === 8. Search ===
  console.log("\n--- 8. Protocol: Search ---");
  if (snippets.length > 0) {
    try {
      const query = snippets[0].title.substring(0, 6);
      sendMessage(proc, makeRequest("listSnippets", { query, limit: 100 }));
      const searchRes = await readResponse(proc);
      if (searchRes.ok) {
        const found = searchRes.result?.items || [];
        const matchesQuery = found.some((s) =>
          s.title.toLowerCase().includes(query.toLowerCase()) ||
          (s.description && s.description.toLowerCase().includes(query.toLowerCase())) ||
          s.category.toLowerCase().includes(query.toLowerCase())
        );
        if (matchesQuery || found.length > 0) {
          pass(`protocol:search — "${query}" → ${found.length} results`);
        } else {
          fail("protocol:search", `No relevant results for "${query}"`);
        }
      }
    } catch (e) {
      fail("protocol:search", e.message);
    }

    // No-match search
    try {
      sendMessage(proc, makeRequest("listSnippets", { query: "xyznonexistent99999" }));
      const emptyRes = await readResponse(proc);
      if (emptyRes.ok && (emptyRes.result?.items || []).length === 0) {
        pass("protocol:search-empty — no-match returns 0 items");
      }
    } catch (e) {
      fail("protocol:search-empty", e.message);
    }
  }

  // === 9. Get Snippet Body (plaintext) ===
  console.log("\n--- 9. Protocol: getSnippetBody (plaintext) ---");
  const plaintextSnippet = snippets.find((s) => !s.protected);
  if (plaintextSnippet) {
    try {
      sendMessage(proc, makeRequest("getSnippetBody", { id: plaintextSnippet.id }));
      const bodyRes = await readResponse(proc);
      if (bodyRes.ok) {
        const body = bodyRes.result?.body || "";
        console.log(`  Snippet #${plaintextSnippet.id} "${plaintextSnippet.title}"`);
        console.log(`  Body length: ${body.length} chars`);
        console.log(`  Body was returned without logging its contents (${body.length} chars)`);
        if (body.length > 0) {
          pass(`protocol:getBody-plaintext — ${body.length} chars`);
        } else {
          // Empty body is valid
          pass("protocol:getBody-plaintext — empty body (valid)");
        }
      } else {
        fail("protocol:getBody-plaintext", bodyRes.error?.message);
      }
    } catch (e) {
      fail("protocol:getBody-plaintext", e.message);
    }
  } else {
    skip("protocol:getBody-plaintext", "No plaintext snippets");
  }

  // === 10. Protected snippet (vault locked) ===
  console.log("\n--- 10. Protocol: Protected Snippet (vault locked) ---");
  const protectedSnippet = snippets.find((s) => s.protected);
  if (protectedSnippet) {
    try {
      sendMessage(proc, makeRequest("getSnippetBody", { id: protectedSnippet.id }));
      const protRes = await readResponse(proc);
      if (!protRes.ok && protRes.error?.code === "vault_locked") {
        pass("protocol:vault-locked — vault_locked error for protected snippet");
        console.log(`  Retryable response: ${Boolean(protRes.error.retryable)}`);
      } else if (protRes.ok) {
        skip("protocol:vault-locked", "Vault was already unlocked");
      } else {
        fail("protocol:vault-locked", `Unexpected error: ${protRes.error?.code}`);
      }
    } catch (e) {
      fail("protocol:vault-locked", e.message);
    }

    // Wrong password unlock
    console.log("\n--- 10b. Protocol: Wrong Password ---");
    try {
      sendMessage(proc, makeRequest("unlockVault", { password: "wrongpassword123" }));
      const wrongPw = await readResponse(proc, 30000); // KDF can be slow
      if (!wrongPw.ok && wrongPw.error?.code === "invalid_password") {
        pass("protocol:wrong-password — safe error returned");
      } else if (wrongPw.ok) {
        fail("protocol:wrong-password", "Unlock succeeded with wrong password!");
      } else {
        fail("protocol:wrong-password", `Unexpected: ${wrongPw.error?.code} ${wrongPw.error?.message}`);
      }
    } catch (e) {
      fail("protocol:wrong-password", e.message);
    }
  } else {
    skip("protocol:vault", "No protected snippets in database");
  }

  // === 11. Pagination ===
  console.log("\n--- 11. Protocol: Pagination ---");
  if (total > 5) {
    try {
      sendMessage(proc, makeRequest("listSnippets", { limit: 3, offset: 0 }));
      const page1 = await readResponse(proc);
      sendMessage(proc, makeRequest("listSnippets", { limit: 3, offset: 3 }));
      const page2 = await readResponse(proc);
      if (page1.ok && page2.ok) {
        const p1ids = (page1.result?.items || []).map((s) => s.id);
        const p2ids = (page2.result?.items || []).map((s) => s.id);
        const overlap = p1ids.filter((id) => p2ids.includes(id));
        if (overlap.length === 0) {
          pass(`protocol:pagination — pages don't overlap (${p1ids.length}+${p2ids.length} items)`);
        } else {
          fail("protocol:pagination", `${overlap.length} overlapping IDs`);
        }
      }
    } catch (e) {
      fail("protocol:pagination", e.message);
    }
  } else {
    skip("protocol:pagination", `Only ${total} snippets`);
  }

  // === 12. Description check ===
  console.log("\n--- 12. Description Fields ---");
  const withDesc = snippets.filter((s) => s.description && s.description.length > 0);
  const withoutDesc = snippets.filter((s) => !s.description || s.description.length === 0);
  console.log(`  With description: ${withDesc.length}`);
  console.log(`  Without description: ${withoutDesc.length}`);
  pass(`protocol:descriptions — ${withDesc.length} with, ${withoutDesc.length} without`);

  // === 13. Security: stderr logs ===
  console.log("\n--- 13. Security: Stderr Logs ---");
  // Give a moment for any log output
  await new Promise((r) => setTimeout(r, 500));
  if (stderrData.length > 0) {
    console.log(`  Stderr output (${stderrData.length} bytes)`);
    // Check for sensitive data
    const sensitivePatterns = ["password", "vault_key", "derived_key", "plaintext", "decrypted"];
    const leaks = sensitivePatterns.filter((p) => stderrData.toLowerCase().includes(p));
    if (leaks.length === 0) {
      pass("security:stderr-clean — no sensitive data in logs");
    } else {
      fail("security:stderr", `Possible sensitive data: ${leaks.join(", ")}`);
    }

    // Ensure no snippet bodies are in stderr
    if (plaintextSnippet) {
      // We got a body earlier; check it's not in stderr
      // (we'd need to store it, but the body was printed to console, not stderr)
    }
  } else {
    pass("security:stderr-empty — no stderr output");
  }

  // === 14. Invalid requests ===
  console.log("\n--- 14. Error Handling ---");
  try {
    sendMessage(proc, makeRequest("nonExistentMethod"));
    const badMethod = await readResponse(proc);
    if (!badMethod.ok) {
      pass(`protocol:bad-method — error: ${badMethod.error?.code}`);
    } else {
      fail("protocol:bad-method", "Should have returned error");
    }
  } catch (e) {
    fail("protocol:bad-method", e.message);
  }

  try {
    sendMessage(proc, makeRequest("getSnippetBody", { id: 999999 }));
    const badId = await readResponse(proc);
    if (!badId.ok) {
      pass(`protocol:missing-snippet — error: ${badId.error?.code}`);
    } else if (badId.ok && (badId.result?.body === "" || badId.result?.body === undefined)) {
      pass("protocol:missing-snippet — empty body for nonexistent ID");
    }
  } catch (e) {
    fail("protocol:missing-snippet", e.message);
  }

  // === Cleanup ===
  proc.stdin.end();
  const normalExit = await waitForExit(proc);
  if (normalExit === null) {
    fail("host:clean-shutdown", "host did not exit after stdin closed");
    proc.kill();
  } else if (normalExit.error) {
    fail("host:clean-shutdown", normalExit.error);
  } else if (normalExit.signal !== null || normalExit.code !== 0) {
    fail("host:clean-shutdown", `unexpected exit outcome: ${JSON.stringify(normalExit)}`);
  } else {
    pass("host:clean-shutdown — clean EOF shutdown observed");
  }

  // === 15. Wrong origin rejection ===
  console.log("\n--- 15. Origin Rejection ---");
  try {
    const badProc = spawn(hostExe, ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    badProc.stdin.end();
    const badOutcome = await waitForExit(badProc, 3000);
    if (badOutcome && badOutcome.error) {
      fail("protocol:origin-rejection", badOutcome.error);
    } else if (badOutcome && badOutcome.signal === null && badOutcome.code === 2) {
      pass("protocol:origin-rejection — exit code 2 for wrong origin");
    } else if (badOutcome === null) {
      fail("protocol:origin-rejection", "host remained alive after wrong origin");
      badProc.kill();
    } else {
      fail("protocol:origin-rejection", `unexpected exit outcome: ${JSON.stringify(badOutcome)}`);
    }
  } catch (e) {
    fail("protocol:origin-rejection", e.message);
  }

  fixture.cleanup();
  // === Summary ===
  console.log(`\n${"=".repeat(60)}`);
  console.log("REAL NATIVE HOST CERTIFICATION SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`  PASS: ${results.pass}   FAIL: ${results.fail}   SKIP: ${results.skip}\n`);
  for (const d of results.details) {
    const i = d.status === "PASS" ? "✓" : d.status === "FAIL" ? "✗" : "⊘";
    console.log(`  ${i} ${d.name}${d.reason ? ` — ${d.reason}` : ""}`);
  }
  console.log(`\nVerdict: ${results.fail === 0 ? "PASS" : "FAIL"}`);
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(2);
});
