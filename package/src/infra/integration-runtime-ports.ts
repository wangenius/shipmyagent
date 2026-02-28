import type { LanguageModel } from "ai";
import type { ShipConfig } from "../utils.js";

/**
 * Integration 运行时端口类型。
 *
 * 关键点（中文）
 * - 这些类型用于描述 intergrations 需要的最小能力面
 * - intergrations 只依赖这些端口，不直接依赖 core 具体实现
 * - 具体实现由 server 在启动时注入
 */

/**
 * 会话请求上下文。
 *
 * 关键点（中文）
 * - 这是跨 integration 共享的最小上下文字段集合。
 */
export type IntegrationContextRequestContext = {
  channel?: "telegram" | "feishu" | "qq" | "cli" | "scheduler" | "api";
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
 *
 * - `withContextRequestContext` 用于在一次调用栈内绑定上下文。
 */
export type IntegrationContextRequestContextBridge = {
  getCurrentContextRequestContext(): IntegrationContextRequestContext | undefined;
  withContextRequestContext<T>(
    ctx: IntegrationContextRequestContext,
    fn: () => T,
  ): T;
};

/**
 * 会话上下文存储端口。
 */
export type IntegrationContextStore = {
  loadAll(): Promise<any[]>;
  loadRange(startIndex: number, endIndex: number): Promise<any[]>;
  append(message: any): Promise<void>;
  getTotalMessageCount(): Promise<number>;
  loadMeta(): Promise<{ pinnedSkillIds?: string[] }>;
  setPinnedSkillIds(skillIds: string[]): Promise<void>;
  createAssistantTextMessage(params: any): any;
};

/**
 * 会话 Agent 端口。
 */
export type IntegrationContextAgent = {
  run(params: { contextId: string; query: string }): Promise<any>;
};

/**
 * 会话管理端口。
 *
 * 关键点（中文）
 * - 对 integration 暴露消息入队、上下文访问、agent 获取等最小能力。
 */
export type IntegrationContextManager = {
  getAgent(contextId: string): IntegrationContextAgent;
  getContextStore(contextId: string): IntegrationContextStore;
  clearAgent(contextId?: string): void;
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
    extra?: Record<string, unknown>;
  }): Promise<void>;
  enqueue(params: {
    channel: string;
    targetId: string;
    contextId: string;
    text: string;
    targetType?: string;
    threadId?: number;
    messageId?: string;
    actorId?: string;
    actorName?: string;
  }): Promise<{ lanePosition: number }>;
};

/**
 * cron 触发定义。
 */
export type IntegrationCronTriggerDefinition = {
  id: string;
  expression: string;
  timezone?: string;
  execute: () => Promise<void> | void;
};

/**
 * cron 引擎端口。
 */
export type IntegrationCronEngine = {
  register(definition: IntegrationCronTriggerDefinition): void;
};

/**
 * 模型工厂端口。
 */
export type IntegrationModelFactory = {
  createModel(input: { config: ShipConfig }): Promise<LanguageModel>;
};
