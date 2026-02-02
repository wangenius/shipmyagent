import fs from "node:fs";
import { fileURLToPath } from "node:url";

function readShipPromptsText(): string {
  const candidates = [new URL("../../src/runtime/prompts.txt", import.meta.url)];

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

  throw new Error(
    `ShipMyAgent: failed to load prompts.txt. Tried: ${tried.join(", ")}`
  );
}

export const DEFAULT_SHIP_PROMPTS = readShipPromptsText();
