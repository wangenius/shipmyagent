import path from "path";
import fs from "fs-extra";
import { Logger } from "../../../../telemetry/index.js";
import { getCacheDirPath } from "../../../../utils.js";
import {
  guessMimeType,
  parseTelegramAttachments,
  sanitizeChatText,
  splitTelegramMessage,
  type TelegramApiResponse,
  type TelegramAttachmentType,
} from "./shared.js";
import type { ChatDispatchAction } from "../../../../types/chat-dispatcher.js";


/**
 * Telegram API client utilities for the Telegram adapter.
 *
 * This module centralizes:
 * - JSON & multipart/form-data requests to Telegram Bot API
 * - file downloads (attachments coming from Telegram)
 * - outbound message + attachment sending
 *
 * Keeping these concerns out of `bot.ts` helps enforce the repo guideline of
 * ≤ 800–1000 lines per module and makes the adapter easier to maintain.
 */
export class TelegramApiClient {
  private readonly botToken: string;
  private readonly rootPath: string;
  private readonly logger: Logger;

  constructor(opts: { botToken: string; projectRoot: string; logger: Logger }) {
    this.botToken = opts.botToken;
    this.rootPath = opts.projectRoot;
    this.logger = opts.logger;
  }

  async requestJson<T>(
    method: string,
    data: Record<string, unknown>,
  ): Promise<T> {
    const url = `https://api.telegram.org/bot${this.botToken}/${method}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const payload = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok) {
      const details = payload?.description ? `: ${payload.description}` : "";
      throw new Error(`Telegram API HTTP ${response.status}${details}`);
    }

    if (!payload?.ok) {
      const code = payload?.error_code ? ` ${payload.error_code}` : "";
      const desc = payload?.description ? `: ${payload.description}` : "";
      throw new Error(`Telegram API error${code}${desc}`);
    }

    return payload.result as T;
  }

  async requestForm<T>(method: string, form: FormData): Promise<T> {
    const url = `https://api.telegram.org/bot${this.botToken}/${method}`;
    const response = await fetch(url, {
      method: "POST",
      body: form,
    });

    const payload = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok) {
      const details = payload?.description ? `: ${payload.description}` : "";
      throw new Error(`Telegram API HTTP ${response.status}${details}`);
    }

    if (!payload?.ok) {
      const code = payload?.error_code ? ` ${payload.error_code}` : "";
      const desc = payload?.description ? `: ${payload.description}` : "";
      throw new Error(`Telegram API error${code}${desc}`);
    }

    return payload.result as T;
  }

  async downloadTelegramFile(
    fileId: string,
    suggestedName?: string,
  ): Promise<string> {
    const file = await this.requestJson<{ file_path?: string }>("getFile", {
      file_id: fileId,
    });
    const filePath =
      typeof (file as any)?.file_path === "string"
        ? String((file as any).file_path)
        : "";
    if (!filePath) {
      throw new Error("Telegram getFile returned empty file_path");
    }

    const url = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Telegram file download failed: HTTP ${res.status}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const baseFromTelegram = path.basename(filePath);
    const base =
      (suggestedName && path.basename(suggestedName)) ||
      baseFromTelegram ||
      `tg-${fileId}`;
    const safeBase =
      base.replace(/[^\w.\-()@\u4e00-\u9fff]+/g, "_").slice(0, 160) ||
      `tg-${fileId}`;

    const dir = path.join(getCacheDirPath(this.rootPath), "telegram");
    await fs.ensureDir(dir);
    const uniq = `${Date.now()}-${fileId.slice(0, 8)}`;
    const outPath = path.join(dir, `${uniq}-${safeBase}`);
    await fs.writeFile(outPath, buf);
    return outPath;
  }

  async sendMessage(
    chatId: string,
    text: string,
    opts?: { messageThreadId?: number },
  ): Promise<void> {
    const parsed = parseTelegramAttachments(sanitizeChatText(text));
    const chunks = splitTelegramMessage(parsed.text);
    const message_thread_id =
      typeof opts?.messageThreadId === "number"
        ? opts.messageThreadId
        : undefined;
    for (const chunk of chunks) {
      if (!chunk) continue;
      try {
        await this.requestJson("sendMessage", {
          chat_id: chatId,
          text: chunk,
          parse_mode: "Markdown",
          ...(message_thread_id ? { message_thread_id } : {}),
        });
      } catch {
        // Fallback to plain text (Markdown is strict and often fails)
        try {
          await this.requestJson("sendMessage", {
            chat_id: chatId,
            text: chunk,
            ...(message_thread_id ? { message_thread_id } : {}),
          });
        } catch (error2) {
          this.logger.error(`Failed to send message: ${String(error2)}`);
        }
      }
    }

    for (const att of parsed.attachments) {
      try {
        await this.sendAttachment(chatId, att, {
          messageThreadId: message_thread_id,
        });
      } catch (e) {
        try {
          await this.requestJson("sendMessage", {
            chat_id: chatId,
            text: `❌ Failed to send ${att.type}: ${String(e)}`,
            ...(message_thread_id ? { message_thread_id } : {}),
          });
        } catch (e2) {
          this.logger.error(
            `Failed to send attachment error message: ${String(e2)}`,
          );
        }
      }
    }
  }

  async sendMessageWithInlineKeyboard(
    chatId: string,
    text: string,
    buttons: Array<{ text: string; callback_data: string }>,
    opts?: { messageThreadId?: number },
  ): Promise<void> {
    const message_thread_id =
      typeof opts?.messageThreadId === "number"
        ? opts.messageThreadId
        : undefined;
    try {
      await this.requestJson("sendMessage", {
        chat_id: chatId,
        text,
        ...(message_thread_id ? { message_thread_id } : {}),
        reply_markup: {
          inline_keyboard: buttons.map((btn) => [
            { text: btn.text, callback_data: btn.callback_data },
          ]),
        },
      });
    } catch (error) {
      this.logger.error(`Failed to send message: ${String(error)}`);
    }
  }

  /**
   * 发送 Telegram chat action（例如 typing）。
   *
   * 关键点（中文）
   * - Telegram 的 typing 指示器会在数秒后自动消失，因此需要周期性发送
   * - 这里仅做一次发送；“心跳/周期”由上层（scheduler）控制
   */
  async sendChatAction(
    chatId: string,
    action: ChatDispatchAction,
    opts?: { messageThreadId?: number },
  ): Promise<void> {
    const message_thread_id =
      typeof opts?.messageThreadId === "number"
        ? opts.messageThreadId
        : undefined;
    await this.requestJson("sendChatAction", {
      chat_id: chatId,
      action,
      ...(message_thread_id ? { message_thread_id } : {}),
    });
  }

  private async sendAttachment(
    chatId: string,
    att: { type: TelegramAttachmentType; pathOrUrl: string; caption?: string },
    opts?: { messageThreadId?: number },
  ): Promise<void> {
    const message_thread_id =
      typeof opts?.messageThreadId === "number"
        ? opts.messageThreadId
        : undefined;
    const caption =
      typeof att.caption === "string" && att.caption.trim()
        ? att.caption.trim().slice(0, 900)
        : undefined;

    const src = att.pathOrUrl.trim();
    const isUrl = /^https?:\/\//i.test(src);

    // URL mode: send via JSON request
    if (isUrl) {
      const method =
        att.type === "photo"
          ? "sendPhoto"
          : att.type === "voice"
            ? "sendVoice"
            : att.type === "audio"
              ? "sendAudio"
              : "sendDocument";
      const field =
        att.type === "photo"
          ? "photo"
          : att.type === "voice"
            ? "voice"
            : att.type === "audio"
              ? "audio"
              : "document";
      await this.requestJson(method, {
        chat_id: chatId,
        [field]: src,
        ...(caption ? { caption } : {}),
        ...(message_thread_id ? { message_thread_id } : {}),
      });
      return;
    }

    const abs = path.isAbsolute(src)
      ? src
      : path.resolve(this.rootPath, src);
    const resolved = path.resolve(abs);
    const root = path.resolve(this.rootPath);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw new Error(`Attachment path must be inside project root: ${src}`);
    }
    if (!(await fs.pathExists(resolved))) {
      throw new Error(`Attachment not found: ${src}`);
    }

    const buf = await fs.readFile(resolved);
    const mime = guessMimeType(resolved);
    const blob = new Blob([buf], mime ? { type: mime } : undefined);
    const form = new FormData();
    form.set("chat_id", chatId);
    if (caption) form.set("caption", caption);
    if (message_thread_id)
      form.set("message_thread_id", String(message_thread_id));

    const method =
      att.type === "photo"
        ? "sendPhoto"
        : att.type === "voice"
          ? "sendVoice"
          : att.type === "audio"
            ? "sendAudio"
            : "sendDocument";
    const field =
      att.type === "photo"
        ? "photo"
        : att.type === "voice"
          ? "voice"
          : att.type === "audio"
            ? "audio"
            : "document";

    form.set(field, blob, path.basename(resolved));
    await this.requestForm(method, form);
  }
}
