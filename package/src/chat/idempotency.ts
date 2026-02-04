/**
 * Chat ingress idempotency (persistent de-duplication).
 *
 * Why this exists
 * - Some chat platforms (or our own adapter layer) can deliver the same inbound message more than once:
 *   - process restarts / multiple instances polling the same inbox
 *   - transient errors causing retries (webhook style)
 *   - misconfigured offsets / race conditions
 * - If we execute the agent for the same user message multiple times, it can look like "one message triggers endless AI generations",
 *   and can also duplicate approvals / tool side-effects.
 *
 * Design
 * - We create an on-disk "claim marker" per (channel + chatKey + messageId).
 * - Creating the marker uses an atomic filesystem operation (`flag: 'wx'`), so multiple processes
 *   will race safely: only one will succeed; the rest will observe "already processed".
 * - If the filesystem operation fails for reasons other than "already exists", we fall back to
 *   allowing processing (better to handle a message twice than to drop it).
 *
 * Storage layout
 * - `${projectRoot}/.ship/.cache/ingress/<channel>/<encode(chatKey)>/<encode(messageId)>.json`
 *
 * Notes
 * - This is intentionally low-tech and local-first: it works without databases and survives restarts.
 * - `messageId` must be stable within the upstream platform. Telegram/Feishu/QQ provide such ids.
 */

import path from "path";
import fs from "fs-extra";
import { getCacheDirPath } from "../utils.js";
import type { ChatDispatchChannel } from "./dispatcher.js";

export async function tryClaimChatIngressMessage(params: {
  projectRoot: string;
  channel: ChatDispatchChannel;
  chatKey: string;
  messageId: string;
  meta?: Record<string, unknown>;
}): Promise<{ claimed: boolean; reason?: string }> {
  const projectRoot = String(params.projectRoot || "").trim();
  const channel = params.channel;
  const chatKey = String(params.chatKey || "").trim();
  const messageId = String(params.messageId || "").trim();
  const meta = params.meta;

  if (!projectRoot || !channel || !chatKey || !messageId) {
    return { claimed: true, reason: "missing_key_fields" };
  }

  const dir = path.join(
    getCacheDirPath(projectRoot),
    "ingress",
    channel,
    encodeURIComponent(chatKey),
  );
  const file = path.join(dir, `${encodeURIComponent(messageId)}.json`);

  try {
    await fs.ensureDir(dir);
  } catch {
    // If we can't ensure the cache directory, don't block message processing.
    return { claimed: true, reason: "ensure_dir_failed" };
  }

  const payload = {
    v: 1,
    channel,
    chatKey,
    messageId,
    claimedAt: Date.now(),
    ...(meta && typeof meta === "object" ? { meta } : {}),
  };

  try {
    await fs.writeFile(file, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    return { claimed: true };
  } catch (e: any) {
    // EEXIST => already processed (idempotency hit)
    if (e && typeof e === "object" && (e as any).code === "EEXIST") {
      return { claimed: false, reason: "already_claimed" };
    }
    // Unknown FS error: don't block processing.
    return { claimed: true, reason: "claim_write_failed" };
  }
}

