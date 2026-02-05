/**
 * 内置 ToolSets（可按需加载）。
 *
 * 说明：
 * - ToolSet 是“工具集合 + 默认 system prompt 描述”。
 * - 通过 `toolset_list` 发现，通过 `toolset_load` 加载（注入 system + 注册 tools）。
 */

import type { ToolSetDefinition } from "../../types/toolset.js";
import { createChatContactTools } from "../tools/builtin/chat-contact.js";
import { getContactBook } from "../../chat/index.js";

export const builtinToolSets: ToolSetDefinition[] = [
  {
    id: "contact_book",
    name: "ContactBook（联系人簿）",
    description: [
      "你已启用联系人簿工具集。",
      "",
      "使用建议：",
      "- 优先用 `chat_contact_lookup` / `chat_contact_list` 找到目标联系人。",
      "- 需要更好记的名字时，用 `chat_contact_set_nickname` 设置昵称；需要手动新增/修正映射时用 `chat_contact_upsert`。",
      "- 删除联系人用 `chat_contact_remove`。",
      "- 发送消息：`chat_contact_send`（注意 QQ 被动回复要求 `chatType + messageId`）。",
    ].join("\n"),
    build: (ctx) => {
      const contacts = getContactBook(ctx.projectRoot);
      return createChatContactTools({ contacts });
    },
  },
];

export function findBuiltinToolSet(query: string): ToolSetDefinition | null {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  return (
    builtinToolSets.find((t) => t.id.toLowerCase() === q) ||
    builtinToolSets.find((t) => t.name.toLowerCase() === q) ||
    builtinToolSets.find((t) => t.name.toLowerCase().includes(q)) ||
    null
  );
}
