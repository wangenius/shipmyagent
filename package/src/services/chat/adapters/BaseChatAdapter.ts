import { PlatformAdapter } from "./PlatformAdapter.js";
import type { ChatDispatchChannel } from "../types/ChatDispatcher.js";
import type { Logger } from "../../../utils/logger/Logger.js";
import type { ServiceRuntimeDependencies } from "../../../main/service/types/ServiceRuntimeTypes.js";
import type { JsonObject, JsonValue } from "../../../types/Json.js";
import { enqueueChatQueue } from "../runtime/ChatQueue.js";

type AdapterUserMessageMeta = {
  [key: string]: JsonValue | undefined;
};

function stripUndefinedMeta(meta: AdapterUserMessageMeta): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * 入站消息统一结构（跨平台最小公共字段）。
 *
 * 说明（中文）
 * - chatId 是平台原始会话标识（非 contextId）
 * - messageThreadId 用于支持 topic/thread 细粒度并发
 * - 该结构只描述“接收侧”，不包含平台发送参数
 */
export type IncomingChatMessage = {
  chatId: string;
  text: string;
  chatType?: string;
  messageId?: string;
  messageThreadId?: number;
  userId?: string;
  username?: string;
};

/**
 * Chat 适配器基类。
 *
 * 关键点（中文）
 * - 通过构造参数接收 context（显式 DI）
 * - 不再依赖全局 runtime getter
 */
export abstract class BaseChatAdapter extends PlatformAdapter {
  protected readonly rootPath: string;
  protected readonly logger: Logger;

  protected constructor(params: {
    channel: ChatDispatchChannel;
    context: ServiceRuntimeDependencies;
  }) {
    super({
      channel: params.channel,
      context: params.context,
    });

    this.rootPath = params.context.rootPath;
    this.logger = params.context.logger;
  }

  /**
   * 清理某个 chatKey 对应的 agent 会话状态。
   *
   * 说明（中文）
   * - 只清理 runtime/context 层状态，不直接删历史文件
   * - 常用于用户触发“重置对话”类命令
   */
  clearChat(chatKey: string): void {
    enqueueChatQueue({
      kind: "control",
      channel: this.channel,
      targetId: chatKey,
      contextId: chatKey,
      text: "",
      control: { type: "clear" },
    });
    this.logger.info(`Cleared chat: ${chatKey}`);
  }

  /**
   * 入站消息写入队列（审计用途，不触发执行）。
   *
   * 说明（中文）
   * - 不直接写 history，由 process 负责落盘
   * - channel/targetId/contextId 三元组由适配层统一补齐
   */
  protected async enqueueAuditMessage(params: {
    chatId: string;
    chatKey: string;
    messageId?: string;
    userId?: string;
    text: string;
    meta?: AdapterUserMessageMeta;
  }): Promise<void> {
    const meta = (params.meta || {}) as AdapterUserMessageMeta;
    const username = typeof meta.username === "string" ? meta.username : undefined;
    const messageThreadId =
      typeof meta.messageThreadId === "number" && Number.isFinite(meta.messageThreadId)
        ? meta.messageThreadId
        : undefined;
    const chatType = typeof meta.chatType === "string" ? meta.chatType : undefined;
    const extra = stripUndefinedMeta(meta);
    enqueueChatQueue({
      kind: "audit",
      channel: this.channel,
      targetId: params.chatId,
      contextId: params.chatKey,
      actorId: params.userId,
      actorName: username,
      messageId: params.messageId,
      text: params.text,
      threadId: messageThreadId,
      targetType: chatType,
      extra,
    });
  }

  /**
   * 将消息送入会话调度器队列。
   *
   * 返回值语义（中文）
   * - chatKey: lane 归属键（同 key 串行）
   * - position: 当前 lane 中排队位置（便于日志与观测）
   */
  protected async enqueueMessage(
    msg: IncomingChatMessage,
  ): Promise<{ chatKey: string; position: number }> {
    const chatKey = this.getChatKey({
      chatId: msg.chatId,
      chatType: msg.chatType,
      messageThreadId: msg.messageThreadId,
      messageId: msg.messageId,
    });

    const { lanePosition } = enqueueChatQueue({
      kind: "exec",
      channel: this.channel,
      targetId: msg.chatId,
      contextId: chatKey,
      text: msg.text,
      targetType: msg.chatType,
      threadId: msg.messageThreadId,
      messageId: msg.messageId,
      actorId: msg.userId,
      actorName: msg.username,
    });

    return { chatKey, position: lanePosition };
  }
}
