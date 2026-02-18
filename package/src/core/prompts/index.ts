/**
 * prompts 聚合出口。
 *
 * 关键点（中文）
 * - 对外统一暴露 system prompt 构建函数、provider 注册与类型。
 */

export {
  DEFAULT_SHIP_PROMPTS,
  buildContextSystemPrompt,
  transformPromptsIntoSystemMessages,
} from "./system.js";

export type {
  SystemPromptProvider,
  SystemPromptProviderContext,
  SystemPromptProviderOutput,
  SystemPromptProviderResult,
} from "../types/system-prompt-provider.js";
export {
  clearSystemPromptProviders,
  collectSystemPromptProviderResult,
  listSystemPromptProviders,
  registerSystemPromptProvider,
  unregisterSystemPromptProvider,
} from "./system-provider.js";

