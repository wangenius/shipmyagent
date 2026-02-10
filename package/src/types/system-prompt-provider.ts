import type { SystemModelMessage } from "ai";
import type { LoadedSkillV1 } from "./loaded-skill.js";

/**
 * System Prompt Provider 上下文。
 *
 * 关键点（中文）
 * - 这是 core 传给 integrations 的最小上下文
 * - provider 只负责产出 prompt 片段，不参与执行调度
 */
export type SystemPromptProviderContext = {
  projectRoot: string;
  sessionId: string;
  requestId: string;
  allToolNames: string[];
};

/**
 * 单个 provider 的输出。
 */
export type SystemPromptProviderOutput = {
  messages?: SystemModelMessage[];
  activeTools?: string[];
  loadedSkills?: LoadedSkillV1[];
};

/**
 * provider 契约。
 */
export type SystemPromptProvider = {
  id: string;
  order?: number;
  provide:
    | ((ctx: SystemPromptProviderContext) => Promise<SystemPromptProviderOutput>)
    | ((ctx: SystemPromptProviderContext) => SystemPromptProviderOutput);
};

/**
 * 所有 provider 聚合后的输出。
 */
export type SystemPromptProviderResult = {
  messages: SystemModelMessage[];
  activeTools?: string[];
  loadedSkills: Map<string, LoadedSkillV1>;
};

