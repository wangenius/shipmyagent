# Context 重设计：以 `UIMessage[]` 作为唯一 History（存储 + 使用）

> 状态：已落地（实现完成）  
> 目标读者：ShipMyAgent 维护者  
> 关联代码：`package/src/core/runtime/agent.ts`、`package/src/core/runtime/*`、`package/src/core/history/store.ts`、`package/src/core/tools/builtin/chat-contact-send.ts`  
> 关键约束：不考虑向后兼容；以“最简 + 最佳实践”为准。

---

## 1. 背景：为什么要改

旧实现（已移除）的 history 核心链路是：

- 落盘：transcript（history.jsonl）
- 注入：run 时折叠成 `historyText`（system additions）
- 执行中补丁：lane merge 把新消息拼接到当前 user content（字符串追加）

这一套有一致性问题：同一份“历史”在不同阶段被表达成不同形态（system 文本块 / user 内容拼接 / tool 摘要文本），模型难以稳定对齐角色语义。

---

## 2. 现状痛点（归因到根因）

### 2.1 角色语义被破坏

把历史折叠成 `historyText` 再用 `role:"system"` 注入，会让模型把“事实/对话”误当成“系统指令”，对齐风险高，且不同 provider 对 system 权重不同。

### 2.2 多条注入路径导致“同轮输入不稳定”

同一个 run 里可能同时出现：

- `historyText`（system additions）
- （旧）`chat_load_history` 注入的 assistant 块（已移除）
- lane merge 改写 user content

模型看到的“历史形态”随路径变化，调试也难。

### 2.3 compact 是“事后补救”，不是结构化能力

当前主要靠捕获 `context_length` 报错后缩小注入窗口重试；并没有一个稳定的“消息级 compact”抽象（也无法在 UI 层稳定对应）。

---

## 3. 重设计目标（你提出的方向）

### 3.1 单一事实源：每个 chatKey 默认只有一个 `UIMessage[]`

- 一个 chat（一个 `chatKey`）默认维护一个持续增长的 `UIMessage[]`（跨多轮保持同一份）
- history 落盘也直接保存 `UIMessage[]`（JSONL；平时 append，compact 时 rewrite）
- 模型输入直接由这份 `UIMessage[]` 转换得到（不再折叠成 `ChatHistory` 字符串块）

### 3.2 自动 compact：超过 token 窗口自动压缩

- 当 `system + messages` 可能超出上下文窗口时，自动把更早的 UIMessage 段压缩为摘要消息
- 保留最近窗口的原文消息，保证“最近对话”可追溯

### 3.3 稳定的模型输入形态

- `system`：继续用服务端 system prompt（runtime context / Agent.md / DEFAULT_SHIP_PROMPTS / skills section / profile / memory）
- `messages`：来自同一份 UIMessage[] 的稳定转换结果

---

## 4. 关键技术基石（AI SDK 已支持）

你当前依赖的 `ai@6.0.57` 已提供：

- `UIMessage` 类型（role = `system | user | assistant`，以 `parts[]` 表达文本/工具/文件等）
- `convertToModelMessages(uiMessages, { tools }) => ModelMessage[]`

因此新链路可直接以 UIMessage 为中间表示，并稳定转换到 provider 需要的 `ModelMessage[]`。

---

## 5. 新架构总览（一句话）

> 用 `.ship/chat/<chatKey>/messages/history.jsonl` 维护一条持续增长的 UIMessage 序列；Agent.run 每次读取该序列，必要时 compact，然后 `convertToModelMessages()` 生成 `messages` 传给 `streamText()`（并在结束后把最终 assistant UIMessage 落盘）。

---

## 6. 存储设计（落盘结构）

建议每个 chatKey 目录新增：

- `.ship/chat/<encodedChatKey>/messages/history.jsonl`
  - append-only，每行一个 UIMessage（JSON）
  - 只存 `role:user|assistant`（system prompt 不进入这里，避免污染）
- `.ship/chat/<encodedChatKey>/messages/meta.json`
  - compact 游标、最后一次 compact 时间、版本号等
- `.ship/chat/<encodedChatKey>/messages/archive/<ts>-<range>.json`（可选但推荐）
  - 存被 compact 掉的原始消息段（用于追溯/检索/调试）

> 取舍：archive 会增加磁盘占用，但能把“生成式摘要”变为可审计。

---

## 7. UIMessage 规范（最小可行）

### 7.1 基本结构

按 AI SDK 类型：

- `id: string`
- `role: "user" | "assistant"`
- `parts: [{ type:"text", text:string }, ...]`
- `metadata?: {...}`（建议使用，利于 compact/追溯）

### 7.2 推荐 metadata（强烈建议）

用于稳定关联 ingress/egress 与 compact：

- `ts: number`
- `chatKey/channel/chatId`
- `userId/username/messageId/messageThreadId/chatType`
- `requestId/runId`
- `kind: "normal" | "summary"`
- `sourceRange?: { fromId: string; toId: string; count: number }`（summary 来源范围）

---

## 8. 运行时流程（Ingress → Agent.run → Egress）

### 8.1 Ingress（收到用户消息）

1) 写入 history：
   - append `UIMessage(role:"user")` 到 `history.jsonl`
2) 入队调度：
   - scheduler enqueue 只负责调度，不负责拼 history

### 8.2 Agent.run（每次送给模型的输入长相）

**固定：system**

`system` 仍是服务器侧拼装（与现状一致）：

- runtime context system prompt
- profile / memory（若有）
- Agent.md + DEFAULT_SHIP_PROMPTS + skills section（启动期缓存）
- skills_load 注入的 SKILL.md（按需）
- 预算 guard（按需）

**统一：messages**

1) 读取 UIMessage[]（该 chatKey 的“单一历史”）
2) auto compact（若需要）
3) 转换为 ModelMessage[]：

```ts
const modelMessages = await convertToModelMessages(uiMessages, { tools });
streamText({ system: baseSystemMessages, messages: modelMessages, tools, ... });
```

> 关键变化：不再把 transcript 窗口格式化为 `historyText(system)` 注入；`chat_load_history` 已移除。

### 8.3 Egress（发给用户 + 写入 history）

1) 发送：仍以 `chat_send` 为准（tool-strict）
2) 落盘：
   - 执行结束后，直接把 **AI SDK v6 生成的最终 `UIMessage(role:"assistant")`** append 到 `history.jsonl`
   - 该 `UIMessage` 会包含 tool invocation / tool output 的 `parts`（例如 `type:"tool-xxx"`），避免我们手工拼装与丢链
   - 若担心膨胀：依赖 auto compact（把更早段压缩为摘要），而不是在落盘阶段裁剪 tool parts

---

## 9. Auto Compact（核心机制）

### 9.1 触发条件（建议双闸）

1) **预估超窗（优先）**：估算 `system + convertToModelMessages(uiMessages)` 的 token 数，超过阈值就 compact
2) **provider 报错兜底**：捕获 `context_length/too long`，立刻 compact 后重试（替代“减少 transcript 注入窗口”）

### 9.2 compact 输出形态（推荐）

- 把更早的消息段压缩成 **1 条 `assistant` summary UIMessage**：
  - `metadata.kind="summary"`
  - `parts[0].text` 是结构化摘要（事实/偏好/决定/未完成事项）
- 保留最近 K 条原文 UIMessage（K 可配置）
- 把被压缩的原文段写入 `archive/`（推荐）

### 9.3 幂等与可审计

- summary 的 `metadata.sourceRange` 记录来源消息范围
- meta.json 记录“已压缩到哪个游标”，防止重复压缩同一段

---

## 10. lane merge（快速矫正）如何变得一致

现状是把新消息拼成字符串追加到“当前 user message content”。新设计建议：

- 新消息到达时 **直接 append 一条新的 `UIMessage(role:"user")`** 到 history.jsonl
- 当前 run 内的“快速矫正”不再通过改写 user content，而是通过“读取到的新 UIMessage”自然进入下一 step 的 messages（或通过一次轻量的 per-run 增量加载）

收益：

- 不破坏消息结构
- 模型看到的是标准的 `user` turn（而不是嵌在同一条 user 的字符串块）

---

## 11. 工具改动建议

### 11.1 `chat_load_history`（已移除）

在“UIMessage 是唯一 history”后，不再需要“把历史折叠成一条 assistant 注入”的工具；历史天然就是 messages 的一部分。
若后续需要“找回被 compact 掉的原文”，应新增专用工具（例如 `chat_history_search`），从 `messages/archive/*` 检索并以标准 messages 形态补齐。

### 11.2 tool 结果的持久化策略

由于 UIMessage 没有 `role:"tool"`，tool 调用链应通过 assistant 的 `parts` 表达：

- 默认：持久化 **完整 assistant UIMessage**（包含 tool parts），保证可审计与可复现
- 如确实需要控制体积：通过 compact（摘要 + archive）来处理“更早消息段”，而不是单独丢弃 tool parts

---

## 12. 配置建议（ship.json）

使用 `context.history` 控制 compact：

- `context.history.keepLastMessages`：compact 后保留最近消息条数（默认 30）
- `context.history.maxInputTokensApprox`：输入预算（近似 token 数，默认 12000）
- `context.history.archiveOnCompact`：compact 时是否归档原始段（默认 true）

---

## 13. 迁移方案（不考虑兼容的前提下的最简策略）

### 13.1 直接切换

- 新会话从此开始写 `history.jsonl`，Agent 仅从 `history.jsonl` 构造 messages
- 旧 transcript 保留作审计，但不再用于模型输入

### 13.2 可选的一次性导入（需要时再做）

- 本轮实现不提供从旧 transcript 的导入（不考虑向后兼容）
- tool 记录不导入或仅导入摘要

---

## 14. 实施步骤（建议按最小闭环推进）

1) 新增 `ChatHistoryStore`（append/load + meta + archive + compact）
2) 修改 ingress：收到用户消息时写 UIMessage
3) 修改 agent：从 UIMessage 构造 `messages`（`convertToModelMessages`），移除 `historyText(system)` 注入
4) 修改 egress：执行结束后把 AI SDK 生成的最终 assistant UIMessage（含 tool parts）写入 `history.jsonl`（缺失时降级写用户可见文本）
5) 加入 auto compact（预估 + 报错兜底重试）
6) 重做 lane merge：改为追加 UIMessage，而不是拼接字符串
7) 移除或重写 `chat_load_history`（已完成：移除）

---

## 15. 待确认的问题（会影响实现细节）

1) compact 后是否必须 archive 原文？
   - 推荐：是（可审计）
2) `keepLastMessages` 默认保留多少条？
3) tool 输出的体积控制怎么做？
   - 推荐 v1：默认持久化 tool parts（可审计/可复现），通过 auto compact + archive 控制增长；必要时再做“按工具类型截断/外部存储”
