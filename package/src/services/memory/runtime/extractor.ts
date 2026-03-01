import {
  generateText,
  isTextUIPart,
  type LanguageModel,
  type UIDataTypes,
  type UIMessagePart,
  type UITools,
} from "ai";
import type {
  MemoryEntry,
  MemoryExtractParams,
  MemoryCompressParams,
} from "../types/memory.js";
import { getLogger } from "../../../utils/logger/logger.js";
import {
  getServiceContextManager,
} from "../../../process/runtime/service-runtime-dependencies.js";
import type { ServiceRuntimeDependencies } from "../../../process/runtime/types/service-runtime-types.js";

type AnyUiMessagePart = UIMessagePart<UIDataTypes, UITools>;

function toUiParts(message: { parts?: AnyUiMessagePart[] } | null | undefined): AnyUiMessagePart[] {
  return Array.isArray(message?.parts) ? message.parts : [];
}

/**
 * 从上下文消息中提取记忆摘要。
 *
 * 关键点（中文）
 * - LLM 处理较重，建议异步触发
 * - context/messages 通过 context 显式注入
 */
export async function extractMemoryFromContextMessages(
  params: MemoryExtractParams & {
    context: ServiceRuntimeDependencies;
    model: LanguageModel;
  },
): Promise<MemoryEntry> {
  const { context, contextId, entryRange, model } = params;
  const [startIndex, endIndex] = entryRange;
  const logger = getLogger(context.rootPath, "info");

  try {
    const contextStore = getServiceContextManager(context).getContextStore(
      contextId,
    );
    const messages = await contextStore.loadRange(startIndex, endIndex);

    const messagesText = (() => {
      const lines: string[] = [];
      for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        const role = message.role === "user" ? "User" : "Assistant";
        const parts = toUiParts(message);
        const text = parts
          .filter(isTextUIPart)
          .map((part) => String(part.text ?? ""))
          .join("\n")
          .trim();
        if (!text) continue;
        lines.push(`${role}: ${text}`);
      }
      return lines.join("\n\n");
    })();

    if (!messagesText || !messagesText.trim()) {
      return {
        timestamp: Date.now(),
        roundRange: entryRange,
        summary: "本轮次暂无有效对话内容。",
        keyFacts: [],
      };
    }

    const result = await generateText({
      model,
      system: [
        {
          role: "system",
          content: `你是一个专业的对话记忆提取助手。你的任务是从用户的对话历史中提取关键信息和摘要。

## 提取要求

1. **摘要内容**（200-500字）：
   - 总结本轮对话的主要主题和讨论内容
   - 突出重要的决策和结论
   - 保留关键的技术细节和参数
   - 使用简洁的中文

2. **关键事实**（3-10条）：
   - 提取可验证的事实信息
   - 用户的偏好和习惯
   - 项目相关的重要信息
   - 技术决策和配置

3. **格式要求**：
   - 以 JSON 格式返回
   - 包含 summary（字符串）和 keyFacts（字符串数组）
   - 不要包含不必要的解释或前缀

## 示例输出

\`\`\`json
{
  "summary": "用户修复了上下文管理的重复消息问题，修改了 loadRecentMessagesAsText 方法移除最后一条 user 消息。随后用户希望优化记忆机制，决定使用固定轮次触发（每25轮）和 LLM 智能压缩策略。",
  "keyFacts": [
    "用户倾向使用简体中文",
    "项目位于 /Users/wzg/Desktop/projects/shipmyagent",
    "修改了 store.ts 的 loadRecentMessagesAsText 方法",
    "决定每25轮触发记忆提取",
    "选择 LLM 智能压缩策略"
  ]
}
\`\`\``,
        },
      ],
      prompt: `请从以下对话历史中提取摘要和关键事实：

${messagesText}

---

请以 JSON 格式返回提取结果。`,
    });

    let summary = "";
    let keyFacts: string[] = [];

    try {
      const text = result.text.trim();
      const jsonMatch =
        text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
        text.match(/(\{[\s\S]*\})/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        summary = String(parsed.summary || "");
        keyFacts = Array.isArray(parsed.keyFacts)
          ? parsed.keyFacts.map(String)
          : [];
      } else {
        summary = text;
        keyFacts = [];
      }
    } catch (parseError) {
      summary = result.text.trim();
      keyFacts = [];
      await logger.log(
        "warn",
        "Failed to parse memory extraction JSON, using raw text",
        {
          contextId,
          entryRange,
          error: String(parseError),
        },
      );
    }

    return {
      timestamp: Date.now(),
      roundRange: entryRange,
      summary: summary || "提取摘要失败",
      keyFacts,
    };
  } catch (error) {
    await logger.log("error", "Failed to extract memory from context messages", {
      contextId,
      entryRange,
      error: String(error),
    });

    return {
      timestamp: Date.now(),
      roundRange: entryRange,
      summary: `记忆提取失败：${String(error)}`,
      keyFacts: [],
    };
  }
}

/**
 * 使用 LLM 压缩记忆文件。
 *
 * 关键点（中文）
 * - 压缩失败时返回原文，避免数据丢失
 */
export async function compressMemory(
  params: MemoryCompressParams & {
    context: ServiceRuntimeDependencies;
    model: LanguageModel;
  },
): Promise<string> {
  const { context, contextId, currentContent, targetChars, model } = params;
  const logger = getLogger(context.rootPath, "info");

  try {
    const result = await generateText({
      model,
      system: [
        {
          role: "system",
          content: `你是一个专业的记忆压缩助手。你的任务是压缩对话记忆文件，保留最重要的信息。

## 压缩要求

1. **保留核心信息**：
   - 用户的基本信息和偏好
   - 重要的技术决策和配置
   - 关键的项目信息
   - 最近的对话摘要（优先保留）

2. **删除冗余内容**：
   - 重复的信息
   - 过时的细节
   - 次要的技术讨论
   - 临时性的内容

3. **格式保持**：
   - 保持原有的 Markdown 格式
   - 保持清晰的结构层次
   - 使用简洁的中文

4. **目标长度**：
   - 压缩后的内容应在 ${targetChars} 字符以内
   - 优先保留最近和最重要的信息`,
        },
      ],
      prompt: `请将以下记忆内容压缩到约 ${targetChars} 字符以内，保留最重要的信息：

${currentContent}

---

请直接返回压缩后的 Markdown 内容，不要添加任何解释或前缀。`,
    });

    const compressed = result.text.trim();

    await logger.log("info", "Memory compressed successfully", {
      contextId,
      originalChars: currentContent.length,
      compressedChars: compressed.length,
      targetChars,
    });

    return compressed;
  } catch (error) {
    await logger.log("error", "Failed to compress memory", {
      contextId,
      error: String(error),
    });

    return currentContent;
  }
}
