#!/usr/bin/env node
// Derives the deterministic Chrome/Edge extension ID from the public key
// committed in extension/dist/manifest.json (or source manifest).
//
// Chromium computes an unpacked-extension ID as:
//   SHA-256(DER SubjectPublicKeyInfo) -> first 16 bytes rendered as hex
//   -> each hex nibble (0-9a-f) mapped to 'a'..'p' -> 32-character ID
//
// Usage: node scripts/get-extension-id.mjs [path/to/manifest.json]
// Prints the 32-character extension ID.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.argv[2] ?? "extension/dist/manifest.json");
const raw = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(raw);

const key = manifest.key;
if (typeof key !== "string" || key.length === 0) {
  console.error(`manifest ${manifestPath} has no "key" field`);
  process.exit(1);
}

const spkiDer = Buffer.from(key, "base64");
if (spkiDer.length === 0) {
  console.error(`manifest key is not valid base64`);
  process.exit(1);
}

const hex = createHash("sha256").update(spkiDer).digest("hex");
const id = Array.from(hex.slice(0, 32))
  .map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
  .join("");

process.stdout.write(id + "\n");
