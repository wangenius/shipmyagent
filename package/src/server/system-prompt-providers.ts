import {
  clearSystemPromptProviders,
  registerSystemPromptProvider,
} from "../core/prompts/system-provider.js";
import type { ServiceRuntimeDependencies } from "../infra/service-runtime-types.js";
import { memorySystemPromptProvider } from "../services/memory/runtime/system-provider.js";
import { createSkillsSystemPromptProvider } from "../services/skills/runtime/system-provider.js";

/**
 * 注册 services 的 system prompt providers。
 *
 * 关键点（中文）
 * - 该职责属于 server 启动编排，不放在 service 模块目录
 * - 启动时一次性注册，runtime 只消费 provider 聚合结果
 * - 不做兼容分支，重复注册时以 id 覆盖
 */
/**
 * 参数约定（中文）
 * - `getContext` 由 server 注入统一的 service 运行依赖。
 * - provider 自己决定是否使用这些依赖。
 */
export function registerServiceSystemPromptProviders(params: {
  getContext: () => ServiceRuntimeDependencies;
}): void {
  clearSystemPromptProviders();
  registerSystemPromptProvider(createSkillsSystemPromptProvider(params.getContext));
  registerSystemPromptProvider(memorySystemPromptProvider);
}
