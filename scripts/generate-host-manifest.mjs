#!/usr/bin/env node
/**
 * Generates the native-host manifest with the deterministic extension ID.
 * Usage: node scripts/generate-host-manifest.mjs [manifestPath] [hostExePath] [outPath]
 * Defaults: extension/dist/manifest.json -> %LOCALAPPDATA%\\CopyIt Browser Extension\\native-host\\com.quantdale.copyit.json
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.argv[2] ?? "extension/dist/manifest.json");
let hostExePath = process.argv[3] ?? null;
const outPath = resolve(process.argv[4] ?? "native-host/com.quantdale.copyit.json.example");

let raw;
try {
  raw = readFileSync(manifestPath, "utf8");
} catch {
  // fallback to source manifest if dist not built yet
  raw = readFileSync(resolve("extension/manifest.json"), "utf8");
}
const manifest = JSON.parse(raw);
const key = manifest.key;
if (typeof key !== "string" || key.length === 0) {
  console.error(`manifest ${manifestPath} has no "key"`);
  process.exit(1);
}
const spkiDer = Buffer.from(key, "base64");
const hex = createHash("sha256").update(spkiDer).digest("hex");
const id = Array.from(hex.slice(0, 32))
  .map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
  .join("");

if (!hostExePath) {
  const localAppData = process.env.LOCALAPPDATA ?? "%LOCALAPPDATA%";
  hostExePath = `${localAppData}\\CopyIt Browser Extension\\native-host\\copyit-native-host.exe`;
}

const hostManifest = {
  name: "com.quantdale.copyit",
  description: "Native bridge for the CopyIt browser extension",
  path: hostExePath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${id}/`],
};

mkdirSync(resolve(outPath, ".."), { recursive: true });
writeFileSync(outPath, JSON.stringify(hostManifest, null, 2) + "\n");
console.log(`Extension ID: ${id}`);
console.log(`Wrote host manifest to ${outPath}`);
console.log(`allowed_origins: chrome-extension://${id}/`);
