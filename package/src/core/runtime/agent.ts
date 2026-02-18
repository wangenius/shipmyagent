import { SessionAgentRunner } from "./agent-runner.js";
import type { SessionAgent } from "../types/session-agent.js";

/**
 * createSessionAgent：创建一个 session 执行器实例。
 *
 * 说明（中文）
 * - core 只暴露工厂与契约，避免把 class 形态扩散到外层
 * - 后续可自由替换实现（函数式/组合式），不影响 SessionManager
 */
export function createSessionAgent(): SessionAgent {
  return new SessionAgentRunner();
}

export type { SessionAgent } from "../types/session-agent.js";
