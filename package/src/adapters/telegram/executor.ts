import { Logger } from "../../runtime/logging/index.js";
import { createPermissionEngine } from "../../runtime/permission/index.js";
import type { AgentRuntime } from "../../runtime/agent/index.js";
import type { ChatStore } from "../../runtime/chat/store.js";
import { sendFinalOutputIfNeeded } from "../../runtime/chat/final-output.js";
import { canApproveTelegram } from "./approvals.js";
import { getActorName, type TelegramUpdate, type TelegramUser } from "./shared.js";

/**
 * Telegram instruction execution flow.
 *
 * This module encapsulates the "run agent + approvals + fallback output" logic:
 * - append user message to ChatStore
 * - handle approval replies (natural language) before normal execution
 * - run AgentRuntime with telegram context
 * - if pending approvals are created, notify the chat
 * - if agent forgot to call `chat_send`, send final output as a fallback
 */
export async function executeTelegramAndReply(params: {
  projectRoot: string;
  logger: Logger;
  requestJson: <T>(method: string, data: Record<string, unknown>) => Promise<T>;
  chatStore: Pick<ChatStore, "append">;
  getOrCreateRuntime: (chatKey: string) => AgentRuntime;
  notifyPendingApprovals: () => Promise<void>;
  buildChatKey: (chatId: string, messageThreadId?: number) => string;
  sendMessage: (
    chatId: string,
    text: string,
    opts?: { messageThreadId?: number },
  ) => Promise<void>;
  input: {
    chatId: string;
    instructions: string;
    from?: TelegramUser;
    messageId?: string;
    chatType?: NonNullable<TelegramUpdate["message"]>["chat"]["type"];
    messageThreadId?: number;
    chatKey?: string;
  };
}): Promise<void> {
  const key =
    params.input.chatKey ||
    params.buildChatKey(params.input.chatId, params.input.messageThreadId);
  const agentRuntime = params.getOrCreateRuntime(key);

  if (!agentRuntime.isInitialized()) {
    await agentRuntime.initialize();
  }

  const chatKeyResolved = key;
  const actorId = params.input.from?.id ? String(params.input.from.id) : undefined;
  const actorUsername = params.input.from?.username
    ? String(params.input.from.username)
    : undefined;
  const actorName = getActorName(params.input.from);

  await params.chatStore.append({
    channel: "telegram",
    chatId: params.input.chatId,
    chatKey: chatKeyResolved,
    userId: actorId,
    messageId: params.input.messageId,
    role: "user",
    text: params.input.instructions,
    meta: {
      chatType: params.input.chatType,
      actorId,
      actorUsername,
      actorName,
    },
  });

  try {
    const permissionEngine = createPermissionEngine(params.projectRoot);
    const pending = permissionEngine
      .getPendingApprovals()
      .filter((req: any) => {
        const meta = (req as any)?.meta as
          | { chatKey?: string; source?: string }
          | undefined;
        return meta?.chatKey === chatKeyResolved && meta?.source === "telegram";
      });
    if (pending.length > 0) {
      const can = await canApproveTelegram(
        params.projectRoot,
        params.requestJson,
        params.logger,
        String((pending[0] as any).id),
        actorId,
      );
      if (!can.ok) {
        await params.sendMessage(
          params.input.chatId,
          "⛔️ 当前有待审批操作，仅发起人或群管理员可以回复审批。",
          { messageThreadId: params.input.messageThreadId },
        );
        return;
      }
    }
  } catch {
    // ignore
  }

  const approvalResult = await agentRuntime.handleApprovalReply({
    userMessage: params.input.instructions,
    context: {
      source: "telegram",
      userId: params.input.chatId,
      chatKey: chatKeyResolved,
      actorId,
    },
    chatKey: chatKeyResolved,
  });
  if (approvalResult) return;

  const context = {
    source: "telegram" as const,
    userId: params.input.chatId,
    chatKey: chatKeyResolved,
    actorId,
    chatType: params.input.chatType,
    actorUsername,
    messageThreadId: params.input.messageThreadId,
    replyMode: "tool" as const,
    messageId: params.input.messageId,
  };

  const result = await agentRuntime.run({
    instructions: params.input.instructions,
    context,
  });

  if (result.pendingApproval) {
    await params.notifyPendingApprovals();
    return;
  }

  await sendFinalOutputIfNeeded({
    channel: "telegram",
    chatId: params.input.chatId,
    output: result.output || "",
    toolCalls: result.toolCalls as any,
    messageThreadId: params.input.messageThreadId,
  });
}

