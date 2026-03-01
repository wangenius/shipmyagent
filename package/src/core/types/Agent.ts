/**
 * Core Agent 运行结果与输入类型。
 *
 * 关键点（中文）
 * - 仅描述 core runtime 的最小输入/输出契约
 * - 不包含具体实现细节
 * - 输出仅暴露 assistantMessage（UIMessage）
 */

import type { ShipContextMessageV1 } from "./ContextMessage.js";

export interface AgentResult {
  success: boolean;
  assistantMessage: ShipContextMessageV1;
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
