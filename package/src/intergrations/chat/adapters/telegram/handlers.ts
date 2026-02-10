import type { TelegramUpdate, TelegramUser } from "./shared.js";
import { getShipRuntimeContext } from "../../../../server/ShipRuntimeContext.js";

/**
 * Telegram command/callback handlers.
 *
 * The main Telegram bot class is intentionally kept lean; these handlers are
 * extracted to keep module size under control and make unit testing easier.
 */

export type TelegramHandlerContext = {
  buildChatKey: (chatId: string, messageThreadId?: number) => string;
  runInChat: (chatKey: string, fn: () => Promise<void>) => Promise<void>;
  sendMessage: (
    chatId: string,
    text: string,
    opts?: { messageThreadId?: number },
  ) => Promise<void>;
  clearChat: (chatKey: string) => void;
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
  getShipRuntimeContext().logger.info(
    `Received command: ${params.command} (${username})`,
  );

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
- /clear - Clear conversation history
- <any message> - Execute instruction`,
      );
      break;

    case "/status":
      await ctx.sendMessage(params.chatId, "📊 Agent status: Running");
      break;

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
  // No-op: approvals are disabled in the simplified "full permission" mode.
  void ctx;
  void callbackQuery;
}
