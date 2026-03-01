import type { Logger } from "../../../../utils/logger/Logger.js";

/**
 * Telegram 访问控制辅助函数。
 *
 * 说明（中文）
 * - 用于群聊场景的最小权限判定（是否管理员）
 * - 仅决定“是否触发执行”，不影响消息入库
 *
 * Telegram access helpers.
 *
 * ShipMyAgent currently runs in "full permission" mode (no human approvals).
 * We still keep a minimal group-access policy for deciding who is allowed to
 * address the bot in group chats when `groupAccess` is not "anyone".
 */
/**
 * 判断用户是否为群管理员/群主。
 *
 * 说明（中文）
 * - 参数异常或接口失败时返回 false（安全优先）
 */
export async function isTelegramAdmin(
  requestJson: <T>(method: string, data: Record<string, string | number>) => Promise<T>,
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
    const status = String(res.status || "").toLowerCase();
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
