import fs from "fs-extra";
import type { SystemPromptProvider } from "../../../types/system-prompt-provider.js";
import {
  getShipProfileOtherPath,
  getShipProfilePrimaryPath,
  getShipSessionMemoryPrimaryPath,
} from "../../../utils.js";

async function readOptionalMarkdown(filePath: string): Promise<string> {
  try {
    if (!(await fs.pathExists(filePath))) return "";
    return String(await fs.readFile(filePath, "utf-8")).trim();
  } catch {
    return "";
  }
}

/**
 * memory system provider。
 *
 * 关键点（中文）
 * - memory 的“加载/组装”位于 integrations
 * - core 只消费最终 system message
 */
export const memorySystemPromptProvider: SystemPromptProvider = {
  id: "memory",
  order: 300,
  async provide(ctx) {
    const messages: Array<{ role: "system"; content: string }> = [];

    const profilePrimary = await readOptionalMarkdown(
      getShipProfilePrimaryPath(ctx.projectRoot),
    );
    if (profilePrimary) {
      messages.push({
        role: "system",
        content: ["# Profile / Primary", profilePrimary].join("\n\n"),
      });
    }

    const profileOther = await readOptionalMarkdown(
      getShipProfileOtherPath(ctx.projectRoot),
    );
    if (profileOther) {
      messages.push({
        role: "system",
        content: ["# Profile / Other", profileOther].join("\n\n"),
      });
    }

    const sessionMemoryPrimary = await readOptionalMarkdown(
      getShipSessionMemoryPrimaryPath(ctx.projectRoot, ctx.sessionId),
    );
    if (sessionMemoryPrimary) {
      messages.push({
        role: "system",
        content: ["# Session Memory / Primary", sessionMemoryPrimary].join(
          "\n\n",
        ),
      });
    }

    return { messages };
  },
};

