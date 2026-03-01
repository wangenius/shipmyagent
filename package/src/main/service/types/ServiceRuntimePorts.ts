import type { LanguageModel } from "ai";
import type { ShipConfig } from "../../types/ShipConfig.js";
import type { ShipContextMetadataV1, ShipContextMessageV1 } from "../../../core/types/ContextMessage.js";
import type { AgentResult, AgentRunInput } from "../../../core/types/Agent.js";

/**
 * Service 运行时端口类型。
 *
 * 关键点（中文）
 * - 这些类型用于描述 services 需要的最小能力面
 * - services 只依赖这些端口，不直接依赖 core 具体实现
 * - 具体实现由 server 在启动时注入
 */

/**
 * 会话请求上下文。
 *
 * 关键点（中文）
 * - 这是跨 service 共享的最小上下文字段集合。
 */
export type ServiceContextRequestContext = {
  chat?: "telegram" | "feishu" | "qq" | "cli" | "scheduler" | "api";
  contextId?: string;
  targetId?: string;
  targetType?: string;
  threadId?: number;
  actorId?: string;
  actorName?: string;
  messageId?: string;
};

/**
 * 请求上下文桥接端口。
 */
export type ServiceContextRequestContextBridge = {
  getCurrentContextRequestContext(): ServiceContextRequestContext | undefined;
  withContextRequestContext<T>(
    ctx: ServiceContextRequestContext,
    fn: () => T,
  ): T;
};

/**
 * 会话上下文存储端口。
 */
export type ServiceContextStore = {
  loadAll(): Promise<ShipContextMessageV1[]>;
  loadRange(startIndex: number, endIndex: number): Promise<ShipContextMessageV1[]>;
  append(message: ShipContextMessageV1): Promise<void>;
  getTotalMessageCount(): Promise<number>;
  loadMeta(): Promise<{ pinnedSkillIds?: string[] }>;
  setPinnedSkillIds(skillIds: string[]): Promise<void>;
  createAssistantTextMessage(params: {
    text: string;
    metadata: Omit<ShipContextMetadataV1, "v" | "ts"> &
      Partial<Pick<ShipContextMetadataV1, "ts">>;
    id?: string;
    kind?: "normal" | "summary";
    source?: "egress" | "compact";
  }): ShipContextMessageV1;
};

/**
 * 会话 Agent 端口。
 */
export type ServiceContextAgent = {
  run(params: AgentRunInput): Promise<AgentResult>;
};

/**
 * 会话管理端口。
 */
export type ServiceContextManager = {
  getAgent(contextId: string): ServiceContextAgent;
  getContextStore(contextId: string): ServiceContextStore;
  clearAgent(contextId?: string): void;
  afterContextUpdatedAsync(contextId: string): Promise<void>;
  appendUserMessage(params: {
    channel: string;
    targetId: string;
    contextId: string;
    text: string;
    actorId?: string;
    actorName?: string;
    messageId?: string;
    threadId?: number;
    targetType?: string;
    requestId?: string;
    extra?: ShipContextMetadataV1["extra"];
  }): Promise<void>;
};

/**
 * cron 触发定义。
 */
export type ServiceCronTriggerDefinition = {
  id: string;
  expression: string;
  timezone?: string;
  execute: () => Promise<void> | void;
};

/**
 * cron 引擎端口。
 */
export type ServiceCronEngine = {
  register(definition: ServiceCronTriggerDefinition): void;
};

/**
 * 模型工厂端口。
 */
export type ServiceModelFactory = {
  createModel(input: { config: ShipConfig }): Promise<LanguageModel>;
};
