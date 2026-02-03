import { Logger } from "../../runtime/logging/index.js";
import { createPermissionEngine } from "../../runtime/permission/index.js";
import type { AgentRuntime } from "../../runtime/agent/index.js";
import { canApproveTelegram } from "./approvals.js";
import type { TelegramUpdate, TelegramUser } from "./shared.js";

/**
 * Telegram command/callback handlers.
 *
 * The main Telegram bot class is intentionally kept lean; these handlers are
 * extracted to keep module size under control and make unit testing easier.
 */

export type TelegramHandlerContext = {
  projectRoot: string;
  logger: Logger;
  requestJson: <T>(method: string, data: Record<string, unknown>) => Promise<T>;
  buildChatKey: (chatId: string, messageThreadId?: number) => string;
  runInChat: (chatKey: string, fn: () => Promise<void>) => Promise<void>;
  sendMessage: (
    chatId: string,
    text: string,
    opts?: { messageThreadId?: number },
  ) => Promise<void>;
  clearChat: (chatKey: string) => void;
  getOrCreateRuntime: (chatKey: string) => AgentRuntime;
};

export async function handleTelegramCommand(
  ctx: TelegramHandlerContext,
  params: {
    chatId: string;
    command: string;
    from?: TelegramUser;
    messageThreadId?: number;
  },
): Promise<void> {
  const username = params.from?.username || "Unknown";
  ctx.logger.info(`Received command: ${params.command} (${username})`);

  const [commandToken, ...rest] = params.command.trim().split(/\s+/);
  const cmd = (commandToken || "").split("@")[0]?.toLowerCase();
  const arg = rest[0];
  const chatKey = ctx.buildChatKey(params.chatId, params.messageThreadId);

  switch (cmd) {
    case "/start":
    case "/help":
      await ctx.sendMessage(
        params.chatId,
        `🤖 ShipMyAgent Bot

Available commands:
- /status - View agent status
- /tasks - View task list
- /logs - View recent logs
- /clear - Clear conversation history
- /approvals - List pending approvals
- /approve <id> - Approve request
- /reject <id> - Reject request
- <any message> - Execute instruction`,
      );
      break;

    case "/status":
      try {
        const permissionEngine = createPermissionEngine(ctx.projectRoot);
        const pending = permissionEngine.getPendingApprovals();
        await ctx.sendMessage(
          params.chatId,
          `📊 Agent status: Running\nPending approvals: ${pending.length}`,
        );
      } catch {
        await ctx.sendMessage(params.chatId, "📊 Agent status: Running");
      }
      break;

    case "/tasks":
      await ctx.sendMessage(params.chatId, "📋 Task list\nNo tasks");
      break;

    case "/logs":
      await ctx.sendMessage(params.chatId, "📝 Logs\nNo logs");
      break;

    case "/approvals": {
      const permissionEngine = createPermissionEngine(ctx.projectRoot);
      const pending = permissionEngine.getPendingApprovals();
      if (pending.length === 0) {
        await ctx.sendMessage(params.chatId, "✅ No pending approvals");
        break;
      }

      const lines = pending
        .slice(0, 10)
        .map((req) => `- ${req.id} (${req.type}): ${req.action}`);
      const suffix =
        pending.length > 10 ? `\n...and ${pending.length - 10} more` : "";
      await ctx.sendMessage(
        params.chatId,
        `⏳ Pending approvals:\n${lines.join("\n")}${suffix}`,
      );
      break;
    }

    case "/approve":
    case "/reject": {
      if (!arg) {
        await ctx.sendMessage(params.chatId, `Usage: ${cmd} <id>`);
        break;
      }

      await ctx.runInChat(chatKey, async () => {
        const can = await canApproveTelegram(
          ctx.projectRoot,
          ctx.requestJson,
          ctx.logger,
          arg,
          params.from?.id ? String(params.from.id) : undefined,
        );
        if (!can.ok) {
          await ctx.sendMessage(params.chatId, can.reason);
          return;
        }

        const agentRuntime = ctx.getOrCreateRuntime(chatKey);
        if (!agentRuntime.isInitialized()) {
          await agentRuntime.initialize();
        }

        const result = await agentRuntime.resumeFromApprovalActions({
          chatKey,
          context: {
            source: "telegram",
            userId: params.chatId,
            chatKey,
            actorId: params.from?.id ? String(params.from.id) : undefined,
          },
          approvals:
            cmd === "/approve" ? { [arg]: "Approved via Telegram command" } : {},
          refused:
            cmd === "/reject" ? { [arg]: "Rejected via Telegram command" } : {},
        });

        await ctx.sendMessage(params.chatId, result.output);
      });
      break;
    }

    case "/clear":
      ctx.clearChat(chatKey);
      await ctx.sendMessage(params.chatId, "✅ Conversation history cleared", {
        messageThreadId: params.messageThreadId,
      });
      break;

    default:
      await ctx.sendMessage(params.chatId, `Unknown command: ${params.command}`);
  }
}

export async function handleTelegramCallbackQuery(
  ctx: TelegramHandlerContext,
  callbackQuery: TelegramUpdate["callback_query"],
): Promise<void> {
  if (!callbackQuery) return;

  const chatId = callbackQuery.message.chat.id.toString();
  const data = callbackQuery.data;
  const actorId = callbackQuery.from?.id ? String(callbackQuery.from.id) : undefined;
  const messageThreadId =
    typeof callbackQuery.message.message_thread_id === "number"
      ? callbackQuery.message.message_thread_id
      : undefined;
  const chatKey = ctx.buildChatKey(chatId, messageThreadId);

  await ctx.runInChat(chatKey, async () => {
    const [action, approvalId] = data.split(":");

    if (action === "approve" || action === "reject") {
      const can = await canApproveTelegram(
        ctx.projectRoot,
        ctx.requestJson,
        ctx.logger,
        approvalId,
        actorId,
      );
      if (!can.ok) {
        await ctx.sendMessage(chatId, can.reason, { messageThreadId });
        return;
      }

      const agentRuntime = ctx.getOrCreateRuntime(chatKey);
      if (!agentRuntime.isInitialized()) {
        await agentRuntime.initialize();
      }

      const result = await agentRuntime.resumeFromApprovalActions({
        chatKey,
        context: { source: "telegram", userId: chatId, chatKey, actorId },
        approvals:
          action === "approve" ? { [approvalId]: "Approved via Telegram" } : {},
        refused:
          action === "reject" ? { [approvalId]: "Rejected via Telegram" } : {},
      });

      await ctx.sendMessage(chatId, result.output, { messageThreadId });
    }
  });
}

