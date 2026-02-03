import { Logger } from "../../runtime/logging/index.js";
import { createPermissionEngine, type ApprovalRequest } from "../../runtime/permission/index.js";

/**
 * Telegram approval helpers.
 *
 * Approval requests are created by the permission engine (e.g. exec_shell).
 * In Telegram we support:
 * - listing pending approvals
 * - approving/rejecting by id
 * - polling-based notifications when new approvals appear
 *
 * Keeping this logic separate makes the main Telegram bot module smaller and
 * easier to reason about.
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

export async function canApproveTelegram(
  projectRoot: string,
  requestJson: <T>(method: string, data: Record<string, unknown>) => Promise<T>,
  logger: Pick<Logger, "warn">,
  approvalId: string,
  actorId?: string,
): Promise<{ ok: boolean; reason: string }> {
  if (!actorId) return { ok: false, reason: "❌ 无法识别审批人身份。" };

  const permissionEngine = createPermissionEngine(projectRoot);
  const req = permissionEngine.getApprovalRequest(approvalId) as any;
  if (!req) {
    return {
      ok: false,
      reason: "❌ 未找到该审批请求（可能已处理或已过期）。",
    };
  }

  const meta = (req as any)?.meta as
    | { initiatorId?: string; userId?: string }
    | undefined;
  const initiatorId = meta?.initiatorId ? String(meta.initiatorId) : undefined;
  if (initiatorId && initiatorId === actorId) {
    return { ok: true, reason: "ok" };
  }

  const originChatId = meta?.userId ? String(meta.userId) : "";
  if (!originChatId) {
    return {
      ok: false,
      reason: "❌ 审批请求缺少来源 chatId，无法校验管理员权限。",
    };
  }

  const isAdmin = await isTelegramAdmin(requestJson, logger, originChatId, actorId);
  if (!isAdmin) {
    return {
      ok: false,
      reason: "⛔️ 仅发起人或群管理员可以审批/拒绝该操作。",
    };
  }

  return { ok: true, reason: "ok" };
}

export async function notifyPendingApprovals(params: {
  projectRoot: string;
  sendMessage: (chatId: string, text: string) => Promise<void>;
  notifiedApprovalKeys: Set<string>;
  logger: Pick<Logger, "error">;
}): Promise<void> {
  try {
    const permissionEngine = createPermissionEngine(params.projectRoot);
    const pending: ApprovalRequest[] = permissionEngine.getPendingApprovals();

    for (const req of pending) {
      const meta = (req as any).meta as
        | { source?: string; userId?: string }
        | undefined;
      const targets: string[] = [];

      // Notify the originating Telegram chat (if available)
      if (meta?.source === "telegram" && meta.userId) {
        targets.push(String(meta.userId));
      }

      if (targets.length === 0) {
        continue;
      }

      for (const target of targets) {
        const key = `${req.id}:${target}`;
        if (params.notifiedApprovalKeys.has(key)) continue;
        params.notifiedApprovalKeys.add(key);

        const command =
          req.type === "exec_shell"
            ? (req.details as { command?: string } | undefined)?.command
            : undefined;
        const actionText = command
          ? `我想执行命令：${command}`
          : `我想执行操作：${req.action}`;

        await params.sendMessage(
          target,
          [
            `⏳ 需要你确认一下：`,
            actionText,
            ``,
            `你可以直接用自然语言回复，比如：`,
            `- “可以” / “同意”`,
            `- “不可以，因为 …” / “拒绝，因为 …”`,
            command ? `- “只同意执行 ${command}”` : undefined,
            `- “全部同意” / “全部拒绝”`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }
  } catch (error) {
    params.logger.error(`Failed to notify pending approvals: ${String(error)}`);
  }
}

