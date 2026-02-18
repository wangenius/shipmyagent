import type { SystemModelMessage } from "ai";

/**
 * System Prompt Provider 上下文。
 *
 * 关键点（中文）
 * - 这是 core 传给 integrations 的最小上下文
 * - provider 只负责产出 prompt 片段，不参与执行调度
 */
export type SystemPromptLoadedSkill = {
  id: string;
  name: string;
  skillMdPath: string;
  content: string;
  allowedTools: string[];
};

export type SystemPromptProviderContext = {
  /** 项目根目录 */
  projectRoot: string;
  /** 当前会话 ID */
  sessionId: string;
  /** 本次请求 ID */
  requestId: string;
  /** 本次可用工具全集 */
  allToolNames: string[];
};

export type SystemPromptProviderOutput = {
  messages?: SystemModelMessage[];
  activeTools?: string[];
  loadedSkills?: SystemPromptLoadedSkill[];
};

export type SystemPromptProvider = {
  id: string;
  order?: number;
  provide:
    | ((ctx: SystemPromptProviderContext) => Promise<SystemPromptProviderOutput>)
    | ((ctx: SystemPromptProviderContext) => SystemPromptProviderOutput);
};

export type SystemPromptProviderResult = {
  messages: SystemModelMessage[];
  activeTools?: string[];
  loadedSkills: Map<string, SystemPromptLoadedSkill>;
};
