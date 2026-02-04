/**
 * Chat egress idempotency (best-effort de-duplication for outbound sends).
 *
 * 问题背景
 * - 在 tool-strict 模式下，模型需要通过 `chat_send` 才能把消息发回平台。
 * - 现实里模型偶尔会在 tool-loop 里重复调用 `chat_send`（甚至参数完全相同），
 *   导致同一条用户消息触发多条重复回复。
 *
 * 设计目标
 * - 以「同一条 inbound messageId」为维度做幂等：同一条用户消息最多发送一次（默认策略）。
 * - 采用本地文件原子创建（flag: 'wx'）实现跨进程去重，避免多实例或重启造成重复发送。
 *
 * 存储布局
 * - `${projectRoot}/.ship/.cache/egress/chat_send/<channel>/<encode(chatId)>/<encode(messageId)>.json`
 *
 * 注意
 * - 只有在能拿到稳定的 `messageId` 时才启用去重；缺失时不阻断发送。
 * - I/O 全部 best-effort：任何异常都不应阻断正常回复。
 */

import path from "path";
import fs from "fs-extra";
import { getCacheDirPath } from "../utils.js";
import type { ChatDispatchChannel } from "./dispatcher.js";

export async function tryClaimChatEgressChatSend(params: {
  projectRoot: string;
  channel: ChatDispatchChannel;
  chatId: string;
  messageId: string;
  meta?: Record<string, unknown>;
}): Promise<
  | { claimed: true; markerFile?: string }
  | { claimed: false; reason: string }
> {
  const projectRoot = String(params.projectRoot || "").trim();
  const channel = params.channel;
  const chatId = String(params.chatId || "").trim();
  const messageId = String(params.messageId || "").trim();
  const meta = params.meta;

  if (!projectRoot || !channel || !chatId || !messageId) {
    return { claimed: false, reason: "missing_key_fields" };
  }

  const dir = path.join(
    getCacheDirPath(projectRoot),
    "egress",
    "chat_send",
    channel,
    encodeURIComponent(chatId),
  );
  const markerFile = path.join(dir, `${encodeURIComponent(messageId)}.json`);

  try {
    await fs.ensureDir(dir);
  } catch {
    // 无法创建目录时，不做去重，直接允许发送（避免掉消息）。
    return { claimed: true };
  }

  const payload = {
    v: 1,
    channel,
    chatId,
    messageId,
    status: "inflight",
    claimedAt: Date.now(),
    ...(meta && typeof meta === "object" ? { meta } : {}),
  };

  try {
    await fs.writeFile(markerFile, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    return { claimed: true, markerFile };
  } catch (e: any) {
    if (e && typeof e === "object" && (e as any).code === "EEXIST") {
      return { claimed: false, reason: "already_claimed" };
    }
    // 未知错误：不要阻断发送（宁可重复，也不要丢消息）。
    return { claimed: true };
  }
}

export async function markChatEgressChatSendDelivered(params: {
  markerFile: string;
  deliveredMeta?: Record<string, unknown>;
}): Promise<void> {
  const markerFile = String(params.markerFile || "").trim();
  if (!markerFile) return;
  try {
    const existing = (await fs.readJson(markerFile).catch(() => null)) as any;
    const next = {
      ...(existing && typeof existing === "object" ? existing : {}),
      status: "delivered",
      deliveredAt: Date.now(),
      ...(params.deliveredMeta && typeof params.deliveredMeta === "object"
        ? { deliveredMeta: params.deliveredMeta }
        : {}),
    };
    await fs.writeJson(markerFile, next, { spaces: 2 });
  } catch {
    // ignore
  }
}

export async function releaseChatEgressChatSendClaim(markerFile: string): Promise<void> {
  const file = String(markerFile || "").trim();
  if (!file) return;
  try {
    await fs.remove(file);
  } catch {
    // ignore
  }
}
