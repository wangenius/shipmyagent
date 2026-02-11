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

export type IntegrationSessionRequestContext = {
  channel?: "telegram" | "feishu" | "qq" | "cli" | "scheduler" | "api";
  sessionId?: string;
  targetId?: string;
  targetType?: string;
  threadId?: number;
  actorId?: string;
  actorName?: string;
  messageId?: string;
};

export type IntegrationSessionRequestContextBridge = {
  getCurrentSessionRequestContext(): IntegrationSessionRequestContext | undefined;
  withSessionRequestContext<T>(
    ctx: IntegrationSessionRequestContext,
    fn: () => T,
  ): T;
};

export type IntegrationSessionHistoryStore = {
  loadAll(): Promise<any[]>;
  loadRange(startIndex: number, endIndex: number): Promise<any[]>;
  append(message: any): Promise<void>;
  getTotalMessageCount(): Promise<number>;
  loadMeta(): Promise<{ pinnedSkillIds?: string[] }>;
  setPinnedSkillIds(skillIds: string[]): Promise<void>;
  createAssistantTextMessage(params: any): any;
};

export type IntegrationSessionAgent = {
  run(params: { sessionId: string; query: string }): Promise<any>;
};

export type IntegrationSessionManager = {
  getAgent(sessionId: string): IntegrationSessionAgent;
  getHistoryStore(sessionId: string): IntegrationSessionHistoryStore;
  clearAgent(sessionId?: string): void;
  appendUserMessage(params: {
    channel: string;
    targetId: string;
    sessionId: string;
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
    sessionId: string;
    text: string;
    targetType?: string;
    threadId?: number;
    messageId?: string;
    actorId?: string;
    actorName?: string;
  }): Promise<{ lanePosition: number }>;
};

export type IntegrationCronTriggerDefinition = {
  id: string;
  expression: string;
  timezone?: string;
  execute: () => Promise<void> | void;
};

export type IntegrationCronEngine = {
  register(definition: IntegrationCronTriggerDefinition): void;
};

export type IntegrationModelFactory = {
  createModel(input: { config: ShipConfig }): Promise<LanguageModel>;
};
