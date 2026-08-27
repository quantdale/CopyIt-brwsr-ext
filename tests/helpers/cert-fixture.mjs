#!/usr/bin/env node
/**
 * Deterministic Vault certification fixture helper.
 *
 * Creates an isolated %APPDATA% directory containing a synthetic CopyIt DB
 * with known password/body so real-browser E2E can run without touching
 * the user's actual vault.
 *
 * Uses the Rust `cert_fixture` binary to ensure crypto byte-compatibility.
 */

import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

export const CERT_PASSWORD = "correct horse battery staple";
export const CERT_PROTECTED_BODY = "COPYIT_CERT_PROTECTED_BODY_2026";
export const CERT_PROTECTED_TITLE = "Protected Bravo";
export const CERT_PLAIN_ALPHA_TITLE = "Plain Alpha";
export const CERT_PLAIN_ALPHA_BODY = "CERT_PLAIN_ALPHA_BODY_2026";
export const CERT_PLAIN_CHARLIE_TITLE = "Plain Charlie";
export const CERT_PLAIN_CHARLIE_BODY = "CERT_PLAIN_CHARLIE_BODY_2026";
export const CERT_CATEGORY_A = "Cert-A";
export const CERT_CATEGORY_B = "Cert-B";

export const CERT_SALT_B64 = "AAECAwQFBgcICQoLDA0ODw==";
export const CERT_VAULT_NONCE_B64 = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw";
export const CERT_PROTECTED_NONCE_B64 = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIz";

const FIXTURE_BIN_CANDIDATES = [
  resolve("native-host/target/debug/cert_fixture.exe"),
  resolve("native-host/target/release/cert_fixture.exe"),
];

function findFixtureBin() {
  for (const p of FIXTURE_BIN_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  // fallback: try building
  try {
    console.log("cert_fixture binary not found, building debug...");
    execFileSync("cargo", ["build", "--manifest-path", "native-host/Cargo.toml", "--bin", "cert_fixture"], { stdio: "inherit" });
    for (const p of FIXTURE_BIN_CANDIDATES) if (existsSync(p)) return p;
  } catch (_e) {
    void _e;
  }
}

/**
 * Creates an isolated APPDATA fixture dir with deterministic DB.
 * @returns {{ tmpDir: string, dataDir: string, dbPath: string, cleanup: () => void }}
 */
export function createCertFixture() {
  const tmpDir = mkdtempSync(join(tmpdir(), "copyit-cert-fixture-"));
  const bin = findFixtureBin();
  execFileSync(bin, [tmpDir], { stdio: "inherit" });
  const dataDir = join(tmpDir, "CopyIt");
  const dbPath = join(dataDir, "copyit.db");
  if (!existsSync(dbPath)) throw new Error(`fixture DB not created at ${dbPath}`);
  return {
    tmpDir,
    dataDir,
    dbPath,
    password: CERT_PASSWORD,
    protectedBody: CERT_PROTECTED_BODY,
    cleanup() {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch (_e) {
        void _e;
      }
    },
  };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\","/")}`) {
  const f = createCertFixture();
  console.log(JSON.stringify({ tmpDir: f.tmpDir, dbPath: f.dbPath }, null, 2));
}
