import {
  clearSystemPromptProviders,
  registerSystemPromptProvider,
} from "../core/prompts/system-provider.js";
import type { IntegrationRuntimeDependencies } from "../infra/integration-runtime-types.js";
import { memorySystemPromptProvider } from "../intergrations/memory/runtime/system-provider.js";
import { createSkillsSystemPromptProvider } from "../intergrations/skills/runtime/system-provider.js";

/**
 * 注册 integrations 的 system prompt providers。
 *
 * 关键点（中文）
 * - 该职责属于 server 启动编排，不放在 integration 模块目录
 * - 启动时一次性注册，runtime 只消费 provider 聚合结果
 * - 不做兼容分支，重复注册时以 id 覆盖
 */
export function registerIntegrationSystemPromptProviders(params: {
  getContext: () => IntegrationRuntimeDependencies;
}): void {
  clearSystemPromptProviders();
  registerSystemPromptProvider(createSkillsSystemPromptProvider(params.getContext));
  registerSystemPromptProvider(memorySystemPromptProvider);
}
