/**
 * Chat contact tools.
 *
 * This module exposes a tiny "address book" surface to the agent so it can:
 * - Look up a contact by username (learned from prior messages)
 * - Send a message to that contact without knowing platform chatIds
 *
 * Delivery is still performed by the platform adapters via dispatcher registry.
 */

import { z } from "zod";
import { tool } from "ai";
import { getChatDispatcher, type ChatDispatchChannel } from "../../../chat/dispatcher.js";
import type { ContactBook } from "../../../chat/contacts.js";

export function createChatContactTools(params: { contacts: ContactBook }): Record<string, any> {
  const contacts = params.contacts;
  const ContactChannelSchema = z.enum(["telegram", "feishu", "qq"]);

  const chat_contact_upsert = tool({
    description:
      "Add or update a contact in the local contact book. Useful when you want to manually register a username and set a nickname.",
    inputSchema: z.object({
      channel: ContactChannelSchema.describe("Contact channel/platform."),
      username: z.string().describe("Contact username / handle."),
      chatId: z.string().describe("Platform chat id (group id / dm id / channel id)."),
      chatKey: z
        .string()
        .optional()
        .describe("Runtime chatKey. If omitted, ShipMyAgent will generate a best-effort value."),
      nickname: z
        .union([z.string(), z.null()])
        .optional()
        .describe("Optional nickname. Use null or empty string to clear."),
      messageId: z.string().optional().describe("Latest inbound message id (best-effort)."),
      userId: z.string().optional().describe("Platform actor user id (best-effort)."),
      chatType: z.string().optional().describe("Chat type (platform-specific; required by QQ to reply)."),
      messageThreadId: z.number().optional().describe("Thread/topic id (platform-specific)."),
    }),
    execute: async (input) => {
      const channel = input.channel as any;
      const username = String(input.username || "").trim();
      const chatId = String(input.chatId || "").trim();
      const chatType = typeof input.chatType === "string" ? input.chatType.trim() : undefined;
      const messageId = typeof input.messageId === "string" ? input.messageId.trim() : undefined;
      const userId = typeof input.userId === "string" ? input.userId.trim() : undefined;
      const messageThreadId =
        typeof input.messageThreadId === "number" && Number.isFinite(input.messageThreadId)
          ? input.messageThreadId
          : undefined;

      if (!username) return { success: false, error: "Missing username" };
      if (!chatId) return { success: false, error: "Missing chatId" };

      let chatKey = String(input.chatKey || "").trim();
      if (!chatKey) {
        // best-effort: mirror adapter chatKey conventions to reduce surprises
        if (channel === "telegram") {
          chatKey =
            typeof messageThreadId === "number" && messageThreadId > 0
              ? `telegram-chat-${chatId}-topic-${messageThreadId}`
              : `telegram-chat-${chatId}`;
        } else if (channel === "feishu") {
          chatKey = `feishu-chat-${chatId}`;
        } else if (channel === "qq") {
          chatKey = `qq-${chatType || "unknown"}-${chatId}`;
        } else {
          chatKey = `${String(channel)}-chat-${chatId}`;
        }
      }

      const nicknameInput = Object.prototype.hasOwnProperty.call(input, "nickname")
        ? input.nickname
        : undefined;
      const nickname =
        typeof nicknameInput === "string" ? nicknameInput : undefined;

      const updated = await contacts.upsert({
        channel,
        username,
        chatId,
        chatKey,
        ...(messageId ? { messageId } : {}),
        ...(userId ? { userId } : {}),
        ...(chatType ? { chatType } : {}),
        ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
        ...(typeof nickname === "string" ? { nickname } : {}),
      });

      if (nicknameInput === null || (typeof nicknameInput === "string" && !nicknameInput.trim())) {
        const cleared = await contacts.setNickname({ username, ...(channel ? { channel } : {}), nickname: null });
        return { success: true, contact: cleared || updated };
      }

      return { success: true, contact: updated };
    },
  });

  const chat_contact_lookup = tool({
    description:
      "Look up a chat contact by username/nickname (best-effort). Returns a single best match or a list of candidates.",
    inputSchema: z
      .object({
        username: z.string().optional().describe("Username / handle to look up."),
        nickname: z.string().optional().describe("User-defined nickname to look up."),
        query: z.string().optional().describe("Search keyword (username/nickname)."),
        channel: ContactChannelSchema.optional().describe("Optional channel filter."),
      })
      .refine((v) => Boolean(String(v.query || v.username || v.nickname || "").trim()), {
        message: "Missing query/username/nickname",
      }),
    execute: async (input) => {
      const query = String(input.query || input.username || input.nickname || "").trim();
      const channel = input.channel as any;
      if (!query) return { success: false, error: "Missing query" };

      // 优先尝试精确 username 命中（更稳定）
      const exact = await contacts.lookup({ username: query, ...(channel ? { channel } : {}) });
      if (exact) return { success: true, contact: exact, matchType: "exact_username" };

      // 否则做模糊检索（username/nickname 包含）
      const matches = await contacts.search({ query, ...(channel ? { channel } : {}), limit: 10 });
      if (matches.length === 0) {
        return { success: false, error: `No contact found for query: ${query}` };
      }
      if (matches.length === 1) return { success: true, contact: matches[0], matchType: "search" };
      return { success: true, matches, matchType: "search_many" };
    },
  });

  const chat_contact_list = tool({
    description:
      "List recent contacts from the local contact book. Useful for discovering usernames and setting nicknames.",
    inputSchema: z.object({
      channel: ContactChannelSchema.optional().describe("Optional channel filter."),
      limit: z.number().optional().describe("Max results (1-200)."),
    }),
    execute: async (input) => {
      const channel = input.channel as any;
      const limit = typeof input.limit === "number" ? input.limit : undefined;
      const items = await contacts.list({ ...(channel ? { channel } : {}), ...(limit ? { limit } : {}) });
      return { success: true, contacts: items };
    },
  });

  const chat_contact_set_nickname = tool({
    description:
      "Set or clear a user-defined nickname for a contact (by username). Nickname is stored locally in `.ship/data/contact.json`.",
    inputSchema: z.object({
      username: z.string().describe("Contact username / handle."),
      channel: ContactChannelSchema.optional().describe("Optional channel to disambiguate."),
      nickname: z
        .union([z.string(), z.null()])
        .describe("New nickname. Use null or empty string to clear."),
    }),
    execute: async (input) => {
      const username = String(input.username || "").trim();
      const channel = input.channel as any;
      const nickname = input.nickname === null ? null : String(input.nickname ?? "");
      if (!username) return { success: false, error: "Missing username" };
      const updated = await contacts.setNickname({
        username,
        ...(channel ? { channel } : {}),
        nickname,
      });
      if (!updated) return { success: false, error: `No contact found for username: ${username}` };
      return { success: true, contact: updated };
    },
  });

  const chat_contact_remove = tool({
    description: "Remove a contact from the local contact book (by username).",
    inputSchema: z.object({
      username: z.string().describe("Contact username / handle."),
      channel: ContactChannelSchema.optional().describe("Optional channel to remove a single entry."),
    }),
    execute: async (input) => {
      const username = String(input.username || "").trim();
      const channel = input.channel as any;
      if (!username) return { success: false, error: "Missing username" };
      const result = await contacts.remove({ username, ...(channel ? { channel } : {}) });
      return { success: true, ...result };
    },
  });

  const chat_contact_send = tool({
    description:
      "Send a message to a known contact by username. Uses the dispatcher registry to deliver to the correct platform.",
    inputSchema: z.object({
      username: z.string().describe("Username / handle of the contact."),
      text: z.string().describe("Text to send."),
    }),
    execute: async (input) => {
      const username = String(input.username || "").trim();
      const text = String(input.text ?? "");
      if (!username) return { success: false, error: "Missing username" };
      if (!text.trim()) return { success: true };

      const found = await contacts.lookup({ username });
      if (!found) return { success: false, error: `No contact found for username: ${username}` };

      const dispatcher = getChatDispatcher(found.channel as ChatDispatchChannel);
      if (!dispatcher) {
        return { success: false, error: `No dispatcher registered for channel: ${found.channel}` };
      }

      if (found.channel === "qq") {
        const chatType = typeof found.chatType === "string" ? found.chatType.trim() : "";
        const messageId = typeof found.messageId === "string" ? found.messageId.trim() : "";
        if (!chatType || !messageId) {
          return {
            success: false,
            error:
              "QQ requires chatType + messageId to send a reply. Ask the contact to send a message first so ShipMyAgent can learn the latest messageId.",
          };
        }
      }

      return dispatcher.sendText({
        chatId: found.chatId,
        text,
        ...(typeof found.messageThreadId === "number" ? { messageThreadId: found.messageThreadId } : {}),
        ...(typeof found.chatType === "string" && found.chatType ? { chatType: found.chatType } : {}),
        ...(typeof found.messageId === "string" && found.messageId ? { messageId: found.messageId } : {}),
      });
    },
  });

  return {
    chat_contact_upsert,
    chat_contact_lookup,
    chat_contact_list,
    chat_contact_set_nickname,
    chat_contact_remove,
    chat_contact_send,
  };
}
