import type { Logger } from "../../../../telemetry/index.js";

/**
 * Telegram access helpers.
 *
 * ShipMyAgent currently runs in "full permission" mode (no human approvals).
 * We still keep a minimal group-access policy for deciding who is allowed to
 * address the bot in group chats when `groupAccess` is not "anyone".
 */
export async function isTelegramAdmin(
  requestJson: <T>(method: string, data: Record<string, unknown>) => Promise<T>,
  logger: Pick<Logger, "warn">,
  originChatId: string,
  actorId: string,
): Promise<boolean> {
  const chatIdNum = Number(originChatId);
  const userIdNum = Number(actorId);
  if (!Number.isFinite(chatIdNum) || !Number.isFinite(userIdNum)) return false;

  try {
    const res = await requestJson<{ status?: string }>("getChatMember", {
      chat_id: chatIdNum,
      user_id: userIdNum,
    });
    const status = String((res as any)?.status || "").toLowerCase();
    return status === "administrator" || status === "creator";
  } catch (e) {
    logger.warn("Failed to check Telegram admin", {
      originChatId,
      actorId,
      error: String(e),
    });
    return false;
  }
}
