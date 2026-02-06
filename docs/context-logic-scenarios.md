# 当前 Context 逻辑（场景化说明）

> 面向：ShipMyAgent 维护者  
> 范围：解释“每条消息进来，Agent 到底带了哪些上文、什么时候会变干净、如何显式切换/恢复上下文”。  
> 约束：不引入自动 judge；上下文切换由工具显式触发。

---

## 1) 两种“历史”的区别（先把概念对齐）

### 1.1 transcript（平台对话历史，审计账本）

- 落盘：`.ship/chat/<encodedChatKey>/conversations/history.jsonl`（append-only）
- 写入：adapter 收到用户消息会 append；`chat_send` 成功发送后也会 append 一条 assistant（via tool）。见 `package/src/adapters/base-chat-adapter.ts`、`package/src/adapters/platform-adapter.ts`
- 注入：当 **没有 active context** 时，Agent 默认会把 transcript 的“最近窗口”合并为 **一条 assistant message** 注入。见 `package/src/chat/transcript.ts`、`package/src/agent/context/agent.ts`

### 1.2 contexts（工作上下文快照，面向跨轮继续）

- 落盘：`.ship/chat/<encodedChatKey>/contexts/`
  - `active.jsonl`：当前工作上下文（messages，持续追加）
  - `archive/<contextId>.json`：历史快照
  - `index.json`：快照索引（用于检索）
- 写入：每次 Agent run 结束都会 best-effort 追加本轮 `user + assistant` 到 `active.jsonl`（append-only）。见 `package/src/agent/context/agent.ts`、`package/src/chat/contexts-store.ts`
- 注入：如果 `active.jsonl` 里有 messages，则 **直接沿用整个 messages 列表**，并跳过 transcript 注入。见 `package/src/agent/context/agent.ts`

> 关键点（中文）：transcript 是“平台看到的历史”，contexts 是“模型的工作区”。两者并存，互不替代。

---

## 2) 每次 Agent.run 实际拼出来的 messages（顺序）

见 `package/src/agent/context/agent.ts`：

1. runtime system prompt（包含 chatKey/requestId/channel/chatId 等）
2. `.ship/profile/Primary.md` / `other.md`（如果存在）
3. `.ship/chat/<chatKey>/memory/Primary.md`（如果存在）
4. **history 注入（二选一）**
   - 优先：`contexts/active.jsonl` messages（直接拼进 messages 列表）
   - 否则：ChatStore transcript 窗口（合并为一条 assistant message）
5. 当前 user message（原文）

另外：
- 如果同一 chatKey 在 Agent 执行期间又来了新消息，lane scheduler 会把新消息合并为“矫正块”追加到当前 user message 末尾（step 之间发生，不改写原 messages）。见 `package/src/chat/lane-scheduler.ts`、`package/src/agent/context/agent.ts`

---

## 3) 场景 A：普通连续对话（两条消息应当“接得上”）

前提：
- 两次消息的 `chatKey` 相同（Telegram 群 topic/thread 不同会导致 chatKey 不同）

流程：
1. 第 1 条用户消息进来：
   - adapter append transcript（user）
   - Agent run：如果 `active.jsonl` 为空/不存在 → 注入 transcript 窗口作为首次历史来源
   - run 结束：把本轮 `user + assistant(优先取 chat_send 的 text)` 追加到 `contexts/active.jsonl`
2. 第 2 条用户消息进来：
   - adapter append transcript（user）
   - Agent run：检测到 `contexts/active.jsonl` 有 messages → 直接沿用该 messages 列表（因此“延续上一轮工作上下文”）

你验证是否“接上了”的最快方式：
- 看 `.ship/chat/<encodedChatKey>/contexts/active.jsonl` 是否在增长（行数是否增加）

---

## 4) 场景 B：背景太乱/太长，和当前消息关系不大（显式开新上下文）

目标：
- 让模型“忘掉工作区”，从干净上下文继续当前这条用户消息。

做法（由模型主动调用）：
- `chat_context_new({ title?, reason? })`

行为（一次调用同时做三件事）：
1. 把当前 `active.jsonl` 归档到 `archive/<contextId>.json`
   - checkpoint = “最后一条 assistant turn”（用于人类/模型定位）
2. 更新 `index.json`（用于后续检索）
3. 清空 active（开始新的 messages 列表），并 **立刻清空本次 run 的 in-flight messages** 到 `system + 当前 user`

见：`package/src/agent/tools/builtin/chat-contexts.ts`、`package/src/chat/contexts-store.ts`

---

## 5) 场景 C：用户说“回到刚才那个上下文/继续上个方案”（恢复旧上下文）

做法：
1. 先 `chat_context_list()` 找到候选 `contextId`
2. 或直接 `chat_context_load({ query: "…" })`
   - 不传 `contextId` 时：会用 query 在 `index.json` 里做 best-effort 文本检索（简单 token contains）

切换语义（很重要）：
- `chat_context_load` 会把选中的快照 **切换为当前 active**（覆盖 `active.jsonl`），本次 run 也会立刻使用该 messages 列表继续执行。

见：`package/src/agent/tools/builtin/chat-contexts.ts`

---

## 6) 场景 D：为什么“两次消息像新对话”（最常见原因）

1) **chatKey 变了**
- Telegram：
  - 私聊：`telegram-chat-<chatId>`
  - 群 topic：`telegram-chat-<chatId>-topic-<threadId>`
- 只要 `threadId` 变了，chatKey 就变了 → transcript/contexts 都是不同目录，自然接不上。

2) `.ship/` 不在当前 projectRoot
- 如果你换了启动目录/不同项目根，`.ship/` 路径不同，看起来像“没有延续”。

3) `active.jsonl` 被清空了
- 主动调用了 `chat_context_new` 或 `chat_context_clear_active`

---

## 7) 常用操作速查（给模型/维护者）

- 继续当前工作区（默认行为）：什么都不做，直接回复/执行
- 背景太乱 → 开新上下文：`chat_context_new({ reason: "..." })`
- 找旧上下文：`chat_context_list()` / `chat_context_load({ query: "..." })`
- 强制清空工作区：`chat_context_clear_active()`
