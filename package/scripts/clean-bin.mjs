/**
 * Clean the TypeScript build output directory.
 *
 * Why this exists:
 * - `tsc` does not delete stale outputs when source files are moved/removed.
 * - This repo historically had runtime modules removed/renamed, leaving old
 *   `package/bin/runtime/*` artifacts around, which makes the runtime layout look "messy"
 *   and can accidentally ship outdated code in published builds.
 *
 * This script is intentionally dependency-free.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const binDir = path.resolve(__dirname, "..", "bin");

try {
  await fs.rm(binDir, { recursive: true, force: true });
} catch (error) {
  // `force: true` should prevent most errors, but keep builds resilient.
  console.warn(`[clean-bin] Failed to remove ${binDir}: ${String(error)}`);
}

