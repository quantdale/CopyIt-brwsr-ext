#!/usr/bin/env node
// Phase 5 functional validation for repository-local MCP add-ons.
//
// Launches each server from .mcp.json exactly as configured and proves it
// completes the MCP `initialize` handshake over stdio. No real user profile,
// vault, or CopyIt database is touched: chrome-devtools is launched --headless
// with a throwaway puppeteer profile, and context7 only fetches public docs.
//
// Safe/synthetic only. Exits non-zero if any server fails to initialize.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(resolve(root, ".mcp.json"), "utf8"));
const servers = cfg.mcpServers ?? {};

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "repo-addons-preflight", version: "0.0.0" },
  },
};

function validateOne(id, spec) {
  return new Promise((resolvePromise) => {
    const timeoutMs = 120_000;
    let child;
    const finish = (res) => {
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        // The child may have exited before the cleanup signal was sent.
      }
      resolvePromise(res);
    };
    const timer = setTimeout(() => {
      finish({ id, ok: false, reason: "timeout waiting for initialize response" });
    }, timeoutMs);

    let out = "";
    let responded = false;

    // MCP clients resolve `npx` via the shell on Windows. Join command + args
    // into one string and spawn with shell:true so the npx shim resolves
    // consistently across platforms (trusted, repo-local config only).
    const cmdStr = [spec.command, ...(spec.args ?? [])].join(" ");
    child = spawn(cmdStr, {
      cwd: root,
      env: { ...process.env, ...(spec.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    child.stdout.on("data", (buf) => {
      out += buf.toString();
      for (const line of out.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        let msg;
        try {
          msg = JSON.parse(t);
        } catch {
          continue; // ignore non-JSON logs
        }
        if (msg.id === 1 && msg.result && msg.result.serverInfo && !responded) {
          responded = true;
          finish({
            id,
            ok: true,
            serverInfo: msg.result.serverInfo,
            capabilities: Object.keys(msg.result.capabilities ?? {}),
          });
          return;
        }
        if (msg.id === 1 && msg.error) {
          finish({ id, ok: false, reason: JSON.stringify(msg.error) });
          return;
        }
      }
      out = out.slice(out.lastIndexOf("\n") + 1);
    });

    child.stderr.on("data", (b) => {
      const s = b.toString();
      if (/EACCES|ENOENT|Cannot find module|not found/i.test(s)) {
        finish({ id, ok: false, reason: s.trim().split("\n")[0] });
      }
    });

    child.on("error", (e) => finish({ id, ok: false, reason: e.message }));

    setTimeout(() => {
      try {
        child.stdin.write(JSON.stringify(INIT) + "\n");
      } catch (e) {
        finish({ id, ok: false, reason: "write failed: " + e.message });
      }
    }, 800);
  });
}

const results = [];
for (const [id, spec] of Object.entries(servers)) {
  process.stdout.write(`validating '${id}' ... `);
  const r = await validateOne(id, spec);
  if (r.ok) {
    console.log(
      `OK (server=${r.serverInfo?.name}@${r.serverInfo?.version}, caps=${r.capabilities.join(",") || "-"})`,
    );
  } else {
    console.log(`FAIL (${r.reason})`);
  }
  results.push(r);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`\nMCP VALIDATE: FAIL (${failed.length}/${results.length})`);
  process.exit(1);
}
console.log(`\nMCP VALIDATE: PASS (${results.length}/${results.length})`);
process.exit(0);
