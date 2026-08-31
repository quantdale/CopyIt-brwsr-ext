import { readFileSync } from "node:fs";
import { join } from "node:path";

const ICONS = new Map([
  ["icon16.png", 16],
  ["icon48.png", 48],
  ["icon128.png", 128],
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const iconDirectory = join(process.cwd(), "extension", "icons");

for (const [name, expectedSize] of ICONS) {
  const path = join(iconDirectory, name);
  const bytes = readFileSync(path);
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`${name}: invalid PNG signature`);
  }
  if (bytes.length < 29 || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`${name}: missing PNG IHDR`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(`${name}: expected ${expectedSize}x${expectedSize}, got ${width}x${height}`);
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`${name}: expected 8-bit RGBA PNG, got bit depth ${bitDepth}, color type ${colorType}`);
  }
}

console.log(`Validated ${ICONS.size} CopyIt icon assets.`);
