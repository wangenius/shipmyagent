import fs from "node:fs";
import { fileURLToPath } from "node:url";

function readShipPromptsText(): string {
  // When compiled: bin/runtime/prompts/ship-prompts.js
  // We want to load src/runtime/prompts.txt (shipped in repo/package) for the default prompt text.
  const candidates = [
    // Local dev (running from repo): package/bin/runtime/prompts -> package/src/runtime/prompts.txt
    new URL("../../../src/asset/prompts.txt", import.meta.url),
    // If prompts.txt is copied next to compiled runtime in the future: package/bin/runtime/prompts.txt
    new URL("../prompts.txt", import.meta.url),
  ];

  const tried: string[] = [];
  for (const url of candidates) {
    const filePath = fileURLToPath(url);
    tried.push(filePath);
    try {
      return fs.readFileSync(url, "utf8");
    } catch {
      // try next candidate
    }
  }

  throw new Error(`ShipMyAgent: failed to load prompts.txt. Tried: ${tried.join(", ")}`);
}

export const DEFAULT_SHIP_PROMPTS = readShipPromptsText();
