#!/usr/bin/env node
/**
 * Real Microsoft Edge E2E Certification Suite
 * Launches real msedge.exe with the unpacked extension (deterministic ID)
 * against an isolated deterministic Vault fixture.
 */
import { findEdgeExecutable, runRealBrowserCertification } from "./helpers/real-browser-e2e-helpers.mjs";
import { existsSync } from "node:fs";

const exe = findEdgeExecutable();
if (!exe || !existsSync(exe)) {
  console.error("FATAL: Microsoft Edge not found.");
  console.error("Searched:");
  console.error("  C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
  console.error("  C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe");
  console.error("Install Edge or adjust findEdgeExecutable().");
  process.exit(2);
}
console.log(`Found Edge at: ${exe}`);
await runRealBrowserCertification({ browserName: "Edge", executablePath: exe });
