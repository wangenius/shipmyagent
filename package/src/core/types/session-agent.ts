/**
 * SessionAgent：core 会话执行器契约。
 *
 * 关键点（中文）
 * - core/scheduler 只依赖接口，不依赖具体 class
 * - 便于替换不同 runtime 实现
 */

import type { AgentRunInput, AgentResult } from "./agent.js";

export interface SessionAgent {
  initialize(): Promise<void>;
  run(input: AgentRunInput): Promise<AgentResult>;
  isInitialized(): boolean;
}
