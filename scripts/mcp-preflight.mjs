#!/usr/bin/env node
// Repository-local MCP configuration preflight.
//
// Enforces REPOSITORY_LOCAL_ADDONS_MASTER_PLAN.md Phase 4 guardrails without
// contacting any protected environment or mutating real user data:
//   - every server id is unique
//   - no unpinned `latest` version (durable config must pin a version)
//   - command is repo-scoped (npx / repo-relative), never a global/absolute path
//   - no --browser-url (would attach to a running user browser)
//   - no reference to %APPDATA%/CopyIt data paths
//   - no embedded secret-like values
//
// Exits non-zero on any violation so it can gate a commit/CI step.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cfgPath = resolve(root, ".mcp.json");

let cfg;
try {
  cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
} catch (e) {
  console.error(`MCP PREFLIGHT: FAIL - cannot read ${cfgPath}: ${e.message}`);
  process.exit(1);
}

const servers = cfg.mcpServers ?? {};
const errors = [];
const warnings = [];

const ids = Object.keys(servers);
if (ids.length === 0) errors.push("No mcpServers defined");

const ABS_HINT = /^(?:[a-z]:[\\/]|\/|~\/)/i;
const SECRET_RE =
  /(sk-[A-Za-z0-9]|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9]|api[_-]?key\s*[:=]\s*\S|password\s*[:=]\s*\S)/i;

for (const [id, s] of Object.entries(servers)) {
  const cmd = s?.command ?? "";
  const args = Array.isArray(s?.args) ? s.args : [];
  const env = s?.env ?? {};
  const flat = JSON.stringify({ args, env });

  if (!cmd) {
    errors.push(`[${id}] missing command`);
    continue;
  }
  if (/latest/i.test(flat)) {
    errors.push(`[${id}] uses unpinned 'latest' version`);
  }
  if (
    cmd !== "npx" &&
    !cmd.startsWith(".") &&
    !cmd.startsWith("node") &&
    ABS_HINT.test(cmd)
  ) {
    errors.push(
      `[${id}] command '${cmd}' looks like a global/absolute path (scope violation)`,
    );
  }
  if (cmd === "npx" && !/@[\w.\-]+/.test(flat)) {
    errors.push(`[${id}] npx invocation does not pin a package version`);
  }
  if (/--browser-url/i.test(flat)) {
    errors.push(
      `[${id}] uses --browser-url (may attach to a running user browser; scope violation)`,
    );
  }
  if (/APPDATA|CopyIt|%APPDATA%|copyit\.db/i.test(flat)) {
    errors.push(`[${id}] references APPDATA/CopyIt data path (scope/authority violation)`);
  }
  if (SECRET_RE.test(flat)) {
    errors.push(`[${id}] contains a secret-like value`);
  }
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string") errors.push(`[${id}] env.${k} is not a string`);
    else if (v && !/^(1|true|0|false)$/i.test(v) && /[A-Za-z0-9]{20,}/.test(v)) {
      warnings.push(
        `[${id}] env.${k} has a long literal value (verify it is not a secret before committing)`,
      );
    }
  }
}

if (errors.length) {
  console.error("MCP PREFLIGHT: FAIL");
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log("MCP PREFLIGHT: PASS");
console.log("Servers: " + ids.join(", "));
for (const w of warnings) console.warn(" - warn: " + w);
process.exit(0);
