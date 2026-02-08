import path from "path";

export interface TelegramConfig {
  botToken?: string;
  chatId?: string;
  followupWindowMs?: number;
  groupAccess?: "initiator_or_admin" | "anyone";
  enabled: boolean;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    message_thread_id?: number;
    text?: string;
    caption?: string;
    chat: {
      id: number;
      type?: "private" | "group" | "supergroup" | "channel";
    };
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    photo?: Array<{
      file_id: string;
      width?: number;
      height?: number;
      file_size?: number;
    }>;
    voice?: {
      file_id: string;
      mime_type?: string;
      file_size?: number;
      duration?: number;
    };
    audio?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
      duration?: number;
    };
    reply_to_message?: {
      message_id?: number;
      from?: {
        id: number;
        username?: string;
        first_name?: string;
        last_name?: string;
      };
    };
    from?: {
      id: number;
      is_bot?: boolean;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    entities?: Array<{
      type: string;
      offset: number;
      length: number;
      user?: { id: number; username?: string };
    }>;
    caption_entities?: Array<{
      type: string;
      offset: number;
      length: number;
      user?: { id: number; username?: string };
    }>;
  };
  callback_query?: {
    id: string;
    data: string;
    from?: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    message: {
      message_thread_id?: number;
      chat: {
        id: number;
      };
    };
  };
}

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export type TelegramAttachmentType = "photo" | "document" | "voice" | "audio";

export function sanitizeChatText(text: string): string {
  if (!text) return text;

  let out = text;

  // Remove/compact tool-log style dumps if present
  out = out.replace(
    /(^|\n)Tool Result:[\s\S]*?(?=\n{2,}|$)/g,
    "\n[工具输出已省略：我已在后台读取并提炼关键信息]\n",
  );

  // Collapse very long JSON-ish blocks
  if (out.length > 6000) {
    out =
      out.slice(0, 5800) + "\n\n…[truncated]（如需完整输出请回复“发完整输出”）";
  }

  return out;
}

export function guessMimeType(fileName: string): string | undefined {
  const ext = (path.extname(fileName) || "").toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".ogg":
      return "audio/ogg";
    case ".opus":
      return "audio/opus";
    default:
      return undefined;
  }
}

export function parseTelegramAttachments(text: string): {
  text: string;
  attachments: Array<{
    type: TelegramAttachmentType;
    pathOrUrl: string;
    caption?: string;
  }>;
} {
  const raw = String(text || "");
  const lines = raw.split("\n");
  const attachments: Array<{
    type: TelegramAttachmentType;
    pathOrUrl: string;
    caption?: string;
  }> = [];
  const kept: string[] = [];

  for (const line of lines) {
    const m = line.match(
      /^\s*@attach\s+(photo|image|document|file|voice|audio)\s+(.+?)(?:\s*\|\s*(.+))?\s*$/i,
    );
    if (!m) {
      kept.push(line);
      continue;
    }

    const kindRaw = m[1].toLowerCase();
    const type: TelegramAttachmentType =
      kindRaw === "image" || kindRaw === "photo"
        ? "photo"
        : kindRaw === "file" || kindRaw === "document"
          ? "document"
          : kindRaw === "audio"
            ? "audio"
            : "voice";

    const pathOrUrl = String(m[2] || "").trim();
    const caption = typeof m[3] === "string" ? String(m[3]).trim() : undefined;
    if (!pathOrUrl) continue;
    attachments.push({ type, pathOrUrl, caption: caption || undefined });
  }

  return { text: kept.join("\n").trim(), attachments };
}

function formatActorName(name: string): string {
  return name
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\[\]]/g, "")
    .trim();
}

export function getActorName(from?: {
  first_name?: string;
  last_name?: string;
}): string | undefined {
  const first = typeof from?.first_name === "string" ? from.first_name.trim() : "";
  const last = typeof from?.last_name === "string" ? from.last_name.trim() : "";
  const raw = [first, last].filter(Boolean).join(" ").trim();
  if (!raw) return undefined;
  return formatActorName(raw);
}

export function splitTelegramMessage(text: string): string[] {
  const MAX = 3900; // keep headroom under Telegram's 4096 limit
  if (text.length <= MAX) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX) {
    let cut = remaining.lastIndexOf("\n", MAX);
    if (cut < MAX * 0.6) cut = MAX;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
