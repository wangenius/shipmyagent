/**
 * Send text to a target chat using chatKey.
 *
 * 设计动机（中文）
 * - Task runner / scheduler 需要在“非当前对话上下文”向指定 chatKey 投递消息
 * - 复用现有 dispatcher 与 chat history（尤其 QQ 的被动回复依赖 messageId）
 *
 * 注意
 * - 这里是运行时内部能力（不是 tool）；tool `chat_contact_send` 也会复用本实现
 */

import { getChatSender, type ChatDispatchChannel } from "./chat-send-registry.js";
import type { ShipContextMessageV1 } from "../../../infra/context-history-types.js";
import { getIntegrationContextManager } from "../../../infra/integration-runtime-dependencies.js";
import type { IntegrationRuntimeDependencies } from "../../../infra/integration-runtime-types.js";

type DispatchableChannel = "telegram" | "feishu" | "qq";

/**
 * 解析 chatKey 为 dispatch 参数。
 *
 * 支持格式（中文）
 * - telegram-chat-<id>
 * - telegram-chat-<id>-topic-<thread>
 * - feishu-chat-<id>
 * - qq-<chatType>-<chatId>
 */
export function parseChatKeyForDispatch(chatKey: string): {
  channel: DispatchableChannel;
  chatId: string;
  chatType?: string;
  messageThreadId?: number;
} | null {
  const key = String(chatKey || "").trim();
  if (!key) return null;

  // Telegram: telegram-chat-<id> 或 telegram-chat-<id>-topic-<thread>
  // 关键点（中文）：chatId 可能是负数（例如 supergroup：-100...），因此不能排除 `-`。
  const tgTopic = key.match(/^telegram-chat-(\S+)-topic-(\d+)$/i);
  if (tgTopic) {
    const chatId = String(tgTopic[1] || "").trim();
    if (!chatId) return null;
    return {
      channel: "telegram",
      chatId,
      messageThreadId: Number.parseInt(tgTopic[2], 10),
    };
  }
  const tg = key.match(/^telegram-chat-(\S+)$/i);
  if (tg) {
    const chatId = String(tg[1] || "").trim();
    if (!chatId) return null;
    return { channel: "telegram", chatId };
  }

  // Feishu: feishu-chat-<id>
  const fe = key.match(/^feishu-chat-(.+)$/i);
  if (fe) return { channel: "feishu", chatId: fe[1] };

  // QQ: qq-<chatType>-<chatId>
  const qq = key.match(/^qq-([^-\s]+)-(.+)$/i);
  if (qq) return { channel: "qq", chatType: qq[1], chatId: qq[2] };

  return null;
}

/**
 * 从历史消息逆序提取最近 user 元数据。
 *
 * 算法（中文）
 * - 从尾到头扫描，遇到首个带元数据的 user 消息即返回。
 * - 这样可尽量命中“当前对话最近一次有效入站消息”的上下文。
 */
function pickLatestUserMetaFromMessages(messages: ShipContextMessageV1[]): {
  chatType?: string;
  messageThreadId?: number;
  messageId?: string;
} {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || typeof m !== "object") continue;
    if (m.role !== "user") continue;
    const md = (m as any).metadata || {};
    const chatType =
      typeof md.targetType === "string"
        ? md.targetType.trim()
        : typeof md.chatType === "string"
          ? md.chatType.trim()
          : undefined;
    const messageThreadId =
      typeof md.threadId === "number" && Number.isFinite(md.threadId)
        ? md.threadId
        : typeof md.messageThreadId === "number" && Number.isFinite(md.messageThreadId)
          ? md.messageThreadId
          : undefined;
    const messageId = typeof md.messageId === "string" ? md.messageId.trim() : undefined;
    if (chatType || messageThreadId || messageId) {
      return {
        ...(chatType ? { chatType } : {}),
        ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
        ...(messageId ? { messageId } : {}),
      };
    }
  }
  return {};
}

/**
 * 按 chatKey 发送文本到对应平台。
 *
 * 流程（中文）
 * 1) 解析 chatKey 并定位 channel dispatcher
 * 2) 从 context history 回填 chatType/threadId/messageId
 * 3) 合并参数后调用 dispatcher 发送
 */
export async function sendTextByChatKey(params: {
  context: IntegrationRuntimeDependencies;
  chatKey: string;
  text: string;
}): Promise<{ success: boolean; error?: string }> {
  const context = params.context;
  const chatKey = String(params.chatKey || "").trim();
  const text = String(params.text ?? "");
  if (!chatKey) return { success: false, error: "Missing chatKey" };
  if (!text.trim()) return { success: true };

  const parsed = parseChatKeyForDispatch(chatKey);
  if (!parsed) {
    return { success: false, error: `Unsupported chatKey format: ${chatKey}` };
  }

  const channel = parsed.channel as ChatDispatchChannel;
  const chatId = String(parsed.chatId || "").trim();
  if (!chatId) return { success: false, error: "Missing chatId (from chatKey)" };

  const dispatcher = getChatSender(channel);
  if (!dispatcher) {
    return { success: false, error: `No dispatcher registered for channel: ${channel}` };
  }

  // 关键点（中文）：尽量从 history 的最近 user message 拿到 chatType/messageThreadId/messageId（尤其 QQ 需要）。
  const historyStore = getIntegrationContextManager(context).getHistoryStore(chatKey);
  let messages: ShipContextMessageV1[] = [];
  try {
    messages = await historyStore.loadAll();
  } catch {
    messages = [];
  }
  const meta = pickLatestUserMetaFromMessages(messages);

  const chatType =
    typeof meta.chatType === "string"
      ? meta.chatType
      : typeof parsed.chatType === "string"
        ? parsed.chatType
        : undefined;
  const messageThreadId =
    typeof meta.messageThreadId === "number"
      ? meta.messageThreadId
      : typeof parsed.messageThreadId === "number"
        ? parsed.messageThreadId
        : undefined;
  const messageId = typeof meta.messageId === "string" ? meta.messageId : undefined;

  if (channel === "qq") {
    if (!chatType || !messageId) {
      return {
        success: false,
        error:
          "QQ requires chatType + messageId to send a reply. Ask the target user to send a message first so ShipMyAgent can record the latest messageId in history.",
      };
    }
  }

  return dispatcher.sendText({
    chatId,
    text,
    ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
    ...(typeof chatType === "string" && chatType ? { chatType } : {}),
    ...(typeof messageId === "string" && messageId ? { messageId } : {}),
  }) as any;
}
