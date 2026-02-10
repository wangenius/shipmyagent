import type { AgentRunInput, AgentResult } from "./agent.js";

/**
 * SessionAgent：session 执行器的最小契约。
 *
 * 关键点（中文）
 * - core/scheduler 只依赖这个契约，不依赖具体 class
 * - 具体实现可在后续继续拆分，不影响上层调用
 */
export interface SessionAgent {
  initialize(): Promise<void>;
  run(input: AgentRunInput): Promise<AgentResult>;
  isInitialized(): boolean;
}
