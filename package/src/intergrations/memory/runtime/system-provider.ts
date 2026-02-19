/**
 * Memory system provider。
 *
 * 关键点（中文）
 * - 仅负责把 Primary.md 内容转为 system prompt 片段。
 * - 不做提取/压缩逻辑（那部分在 memory service）。
 */

import fs from "fs-extra";
import type { SystemPromptProvider } from "../../../infra/system-prompt-provider-types.js";
import {
  getShipProfileOtherPath,
  getShipProfilePrimaryPath,
  getShipContextMemoryPrimaryPath,
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
 * memory provider 定义。
 *
 * 关键点（中文）
 * - memory 的“加载/组装”位于 integrations，core 只消费最终 system message。
 * - 若 Primary.md 缺失或为空，则返回空消息列表。
 * - 读取失败走容错，不阻断主流程。
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

    const contextMemoryPrimary = await readOptionalMarkdown(
      getShipContextMemoryPrimaryPath(ctx.projectRoot, ctx.contextId),
    );
    if (contextMemoryPrimary) {
      messages.push({
        role: "system",
        content: ["# Context Memory / Primary", contextMemoryPrimary].join(
          "\n\n",
        ),
      });
    }

    return { messages };
  },
};

