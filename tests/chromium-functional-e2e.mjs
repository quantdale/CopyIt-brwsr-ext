#!/usr/bin/env node
/**
 * Functional compatibility evidence using Playwright's bundled Chromium.
 * This is explicitly Chromium evidence and must not be labeled as Chrome.
 */
import { chromium } from "playwright";
import { runRealBrowserCertification } from "./helpers/real-browser-e2e-helpers.mjs";

const executablePath = chromium.executablePath();
console.log(`Chromium functional executable: ${executablePath}`);
await runRealBrowserCertification({ browserName: "Chromium", executablePath });
