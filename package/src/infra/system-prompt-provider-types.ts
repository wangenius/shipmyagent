/**
 * System prompt provider 类型转发。
 *
 * 关键点（中文）
 * - 源定义在 core/types
 * - service 通过 infra 引用，保持层级边界
 *
 * 用途（中文）
 * - 给 services 提供稳定的类型入口，避免直接反向依赖 core。
 */

export type {
  SystemPromptProviderContext,
  SystemPromptProviderOutput,
  SystemPromptProvider,
  SystemPromptProviderResult,
} from "../core/types/system-prompt-provider.js";
