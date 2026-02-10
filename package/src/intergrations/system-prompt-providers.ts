import {
  clearSystemPromptProviders,
  registerSystemPromptProvider,
} from "../core/prompts/system-provider.js";
import { skillsSystemPromptProvider } from "./skills/runtime/system-provider.js";
import { memorySystemPromptProvider } from "./memory/runtime/system-provider.js";

/**
 * 注册 integrations 的 system prompt providers。
 *
 * 关键点（中文）
 * - 启动时一次性注册，runtime 只消费 provider 聚合结果
 * - 不做兼容分支，重复注册时以 id 覆盖
 */
export function registerIntegrationSystemPromptProviders(): void {
  clearSystemPromptProviders();
  registerSystemPromptProvider(skillsSystemPromptProvider);
  registerSystemPromptProvider(memorySystemPromptProvider);
}
