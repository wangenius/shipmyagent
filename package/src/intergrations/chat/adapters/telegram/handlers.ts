import type { Logger } from "../../../../telemetry/index.js";
import type { TelegramUpdate, TelegramUser } from "./shared.js";

/**
 * Telegram command/callback handlers。
 *
 * 关键点（中文）
 * - handler 通过参数接收 logger，不依赖全局 runtime
 * - 方便在不同运行环境复用（server / test）
 */

export type TelegramHandlerContext = {
  logger: Logger;
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
  ctx.logger.info(`Received command: ${params.command} (${username})`);

  const [commandToken] = params.command.trim().split(/\s+/);
  const cmd = (commandToken || "").split("@")[0]?.toLowerCase();
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
  void ctx;
  void callbackQuery;
}
