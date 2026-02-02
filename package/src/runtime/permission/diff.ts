import fs from "fs-extra";
import { diffLines } from "diff";

export async function generateFileDiff(
  filePath: string,
  newContent: string,
): Promise<string> {
  if (!fs.existsSync(filePath)) {
    return `New file: ${filePath}\n\n${newContent}`;
  }

  const oldContent = await fs.readFile(filePath, "utf-8");
  const changes = diffLines(oldContent, newContent);

  let diff = `File: ${filePath}\n\n`;
  for (const change of changes) {
    if (change.added) {
      diff += `+ ${change.value.trimEnd()}\n`;
    } else if (change.removed) {
      diff += `- ${change.value.trimEnd()}\n`;
    }
  }

  return diff;
}

