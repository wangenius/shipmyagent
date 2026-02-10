/**
 * Core 模块入口（barrel exports）。
 *
 * 说明（中文）
 * - 不再区分 agent/chat：统一放在 core 下按职责拆目录
 * - 入口层（server/intergrations/commands）只依赖 core
 */

export type { ChatRequestContext } from "./runtime/request-context.js";
export { chatRequestContext, withChatRequestContext } from "./runtime/request-context.js";


export { ChatRuntime } from "./runtime/chat-runtime.js";
export { ChatHistoryStore } from "./history/store.js";

export { Agent } from "./runtime/index.js";

export type { ChatSkillStateSnapshot } from "./skills/index.js";
export {
  clearChatSkillState,
  getChatSkillState,
  setChatAvailableSkills,
  setChatLoadedSkills,
} from "./skills/index.js";
