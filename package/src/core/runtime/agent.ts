import { ContextAgentRunner } from "./AgentRunner.js";
import type { ContextAgent } from "../types/ContextAgent.js";

/**
 * createContextAgent：创建一个 context 执行器实例。
 *
 * 说明（中文）
 * - core 只暴露工厂与契约，避免把 class 形态扩散到外层
 * - 后续可自由替换实现（函数式/组合式），不影响 ContextManager
 */
export function createContextAgent(): ContextAgent {
  return new ContextAgentRunner();
}
