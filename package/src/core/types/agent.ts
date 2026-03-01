/**
 * Core Agent 运行结果与输入类型。
 *
 * 关键点（中文）
 * - 仅描述 core runtime 的最小输入/输出契约
 * - 不包含具体实现细节
 */

import type { ShipContextMessageV1 } from "./context-message.js";
import type { JsonObject } from "../../types/json.js";

export interface AgentResult {
  success: boolean;
  output: string;
  toolCalls: Array<{
    tool: string;
    input: JsonObject;
    output: string;
  }>;
  assistantMessage?: ShipContextMessageV1;
}

export interface AgentRunInput {
  contextId: string;
  query: string;
  drainLaneMerged?: () => Promise<{
    drained: number;
    messages: Array<{
      text: string;
      messageId?: string;
      actorId?: string;
      actorName?: string;
      targetType?: string;
      threadId?: number;
    }>;
  } | null>;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: number;
}
