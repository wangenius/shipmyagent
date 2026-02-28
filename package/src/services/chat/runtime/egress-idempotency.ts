/**
 * Chat egress idempotency（出站去重）。
 *
 * 关键点（中文）
 * - 以同一 inbound messageId + messageKey 为幂等维度
 * - 使用文件原子创建（flag: wx）支持跨进程去重
 */

import path from "path";
import fs from "fs-extra";
import { getCacheDirPath } from "../../../infra/utils/index.js";
import type { ChatDispatchChannel } from "./chat-send-registry.js";
import type { ServiceRuntimeDependencies } from "../../../infra/service-runtime-types.js";

export async function tryClaimChatEgressChatSend(params: {
  context: ServiceRuntimeDependencies;
  channel: ChatDispatchChannel;
  chatId: string;
  messageId: string;
  messageKey: string;
  meta?: Record<string, unknown>;
}): Promise<
  | { claimed: true; markerFile?: string }
  | { claimed: false; reason: string }
> {
  const projectRoot = String(params.context.rootPath || "").trim();
  const channel = params.channel;
  const chatId = String(params.chatId || "").trim();
  const messageId = String(params.messageId || "").trim();
  const messageKey = String(params.messageKey || "").trim();
  const meta = params.meta;

  if (!projectRoot || !channel || !chatId || !messageId || !messageKey) {
    return { claimed: false, reason: "missing_key_fields" };
  }

  const dir = path.join(
    getCacheDirPath(projectRoot),
    "egress",
    "chat_send",
    channel,
    encodeURIComponent(chatId),
  );
  const markerFile = path.join(dir, `${encodeURIComponent(messageKey)}.json`);

  try {
    await fs.ensureDir(dir);
  } catch {
    return { claimed: true };
  }

  const payload = {
    v: 1,
    channel,
    chatId,
    messageId,
    messageKey,
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
  } catch (error: any) {
    if (error && typeof error === "object" && (error as any).code === "EEXIST") {
      return { claimed: false, reason: "already_claimed" };
    }
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

export async function releaseChatEgressChatSendClaim(
  markerFile: string,
): Promise<void> {
  const file = String(markerFile || "").trim();
  if (!file) return;
  try {
    await fs.remove(file);
  } catch {
    // ignore
  }
}
