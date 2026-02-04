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
import { getChatDispatcher, type ChatDispatchChannel } from "../chat/dispatcher.js";
import type { ContactBook } from "../chat/contacts.js";

export function createChatContactTools(params: { contacts: ContactBook }): Record<string, any> {
  const contacts = params.contacts;

  const chat_contact_lookup = tool({
    description:
      "Look up a chat contact by username. Returns the latest known channel + chatId for that username (best-effort).",
    inputSchema: z.object({
      username: z.string().describe("Username / handle to look up."),
    }),
    execute: async (input) => {
      const username = String(input.username || "").trim();
      if (!username) return { success: false, error: "Missing username" };
      const found = await contacts.lookup({ username });
      if (!found) return { success: false, error: `No contact found for username: ${username}` };
      return { success: true, contact: found };
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

  return { chat_contact_lookup, chat_contact_send };
}
