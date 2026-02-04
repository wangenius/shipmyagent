# 简化版运行逻辑说明（当前实现）

本文档说明：ShipMyAgent 在最近一次“上下文重构 + 精简”后的**实际运行逻辑**是什么、消息如何流转、上下文如何构造、哪些子系统已移除。

> 约定：本文以 `package/src` 源码为准（npm 包 `shipmyagent` 的实现）。

---

## 1. 一句话总览（消息流）

**平台消息** → Adapter 解析/归一化 → 计算 `chatKey` → 写入 `ChatStore`（`.ship/chats/*.jsonl`）→ 入全局 `QueryQueue`（并发=1）→ `AgentRuntime.run()` → `ToolLoopAgent.generate()`（工具循环）→ 模型调用 `chat_send` 回发（否则 fallback）→ Adapter 把 assistant 回复同样落盘到 `ChatStore`。

关键点（与旧版本差异最大）：
- 每次请求只构造一个 `system` message：`Agent.md + DefaultPrompt`
- user message **保持原文**（runtime 不加任何前缀）
- 历史上下文默认来自 **in-memory session history**
- 需要更多落盘历史时，模型显式调用 `chat_load_history` 注入更多消息

---

## 2. 关键对象与职责（依赖方向）

### 2.1 Adapter（平台适配器）

职责：
- 把平台事件解析成 `IncomingChatMessage`
- 计算稳定的 `chatKey`（会话隔离）
- 将 user/assistant 消息 append 到 `ChatStore`
- 通过 dispatcher 注册“发送能力”（供 `chat_send` 工具使用）
- 将消息放入全局 `QueryQueue`，由队列串行触发 runtime

代码位置：
- 基类：`package/src/adapters/base-chat-adapter.ts`
- 队列：`package/src/adapters/query-queue.ts`

### 2.1.1 ContactBook（联系人/地址簿，best-effort）

用途：
- 把 `username` →（channel/chatId/chatKey/userId…）映射持久化到 `.ship/contacts.json`
- 让 agent（或工具）后续可以按用户名定位投递目标（best-effort：用户名可能缺失/变化/冲突）

写入时机：
- adapter 在入队前会把 `IncomingChatMessage.username`（如果存在）写入 ContactBook（upsert）
- 因此：**平台事件没有提供 username** 或 adapter 没有填充 `msg.username` 时，不会生成联系人记录

代码位置：
- 存储：`package/src/runtime/chat/contacts.ts`
- 写入：`package/src/adapters/base-chat-adapter.ts`

### 2.2 ChatStore（落盘审计 + 可检索历史）

职责：
- append-only 写入 `.ship/chats/<encode(chatKey)>.jsonl`
- 提供读取最近 entries / 搜索 entries（供工具按需加载）

代码位置：
- `package/src/runtime/chat/store.ts`

### 2.3 AgentRuntime（运行时编排）

职责：
- 每次请求拼装 in-flight messages（见第 3 节）
- 调用 `ToolLoopAgent.generate({ messages })`
- 采集 toolCalls + LLM response 日志
- 更新 in-memory session history（固定上限裁剪）
- 处理“context too long”错误：丢弃较早历史后重试（最多 3 次）

代码位置：
- `package/src/runtime/agent/runtime.ts`

### 2.4 工具层（模型能力边界）

保留核心工具：
- `chat_send`：模型回发用户可见输出（tool-strict）
- `exec_shell`：仓库内执行命令（受权限策略约束/提示词约束）
- `chat_load_history`：按需从 `.ship/chats/*.jsonl` 加载更早消息并注入当前上下文
- MCP tools：存在 `mcpManager` 时动态注册

代码位置：
- toolset 组装：`package/src/runtime/tools/toolset.ts`
- `chat_send`：`package/src/runtime/tools/chat.ts`
- `chat_load_history`：`package/src/runtime/tools/chat-history.ts`
- 注入上下文（给工具改写 in-flight messages）：`package/src/runtime/tools/execution-context.ts`

---

## 3. 上下文如何构造（最重要）

### 3.1 system message = `Agent.md + DefaultPrompt`

每次 `AgentRuntime.run()` 都会构造本轮的 system prompt：

1) `Agent.md`（项目长期指令）
2) `DefaultPrompt`（运行时元信息 + 输出规则）

其中 `DefaultPrompt` 包含：
- Project root / ChatKey / Request ID
- channel/chatId/userId/username 等路由信息（来自 `ChatRequestContext`）
- 输出规则（要求用 `chat_send`；禁止给 user 文本加前缀）

代码位置：
- DefaultPrompt：`package/src/runtime/agent/prompt.ts`
- 拼 system：`package/src/runtime/agent/runtime.ts`

### 3.2 in-flight messages = `[system, ...history, user]`

每轮请求发送给 LLM 的 messages 形态固定为：

1) `system`：`Agent.md + DefaultPrompt`
2) `history`：该 `chatKey` 的 in-memory session（user/assistant/tool）
3) `user`：本轮用户原文（runtime 不做改写）

历史裁剪策略：
- 每轮执行完成后，把本轮 `user + response messages` 追加进 history
- history 超过固定上限会裁剪掉更早的消息（保持成本可控）

### 3.3 按需加载落盘历史：`chat_load_history`

当模型觉得 in-memory history 不够时，可以调用工具：

```ts
await chat_load_history({ limit: 30, keyword?: "xxx" })
```

行为：
- 从 `.ship/chats/<encode(chatKey)>.jsonl` 读取最近 entries 或按 keyword 搜索
- 过滤出 `user/assistant` 消息
- 将这些消息**插入到当前 user message 之前**（不改 user 原文）

这一步发生在一次 agent run 内，通过 `ToolExecutionContext` 完成“对当前 in-flight messages 的注入”。

---

## 4. 错误与降级策略

### 4.1 未配置 LLM（不再 simulation）

旧版存在“simulation mode”（无模型也返回模拟输出）。现在已移除。

当未配置 LLM（或 runtime 未初始化）时，`AgentRuntime.run()` 会直接返回明确错误：
- “LLM is not configured … configure `ship.json.llm` …”

### 4.2 上下文超长（context too long）

当捕获类似 `context_length`/`maximum context` 的错误：
- 丢弃 in-memory history 中较早的一部分后重试
- 最多尝试 3 次；仍失败则清空该 chatKey 的 history 并提示用户重发

---

## 5. 已移除/不再使用的模块（精简清单）

以下子系统已从当前实现中移除（或不再由 runtime 使用）：

- `runtime/storage/*` 及相关工具（`cloud_file_*`、`s3_upload`）
- `runtime/context/*`（上下文压缩器）
- `runtime/memory/*`（长期记忆抽取/注入）
- `runtime/agent/simulation.ts`（simulation fallback）
- Server 的 `.ship/public` 静态路由与 interactive 的 `/public/*` 代理

> 你仓库里如果还存在 `.ship/memory/*` 等文件，属于历史遗留数据，当前 runtime 不会读取/注入。

---

## 6. 最短阅读路径（从入口到回复）

1) `package/src/adapters/*`（平台入口解析 + 入队）
2) `package/src/adapters/query-queue.ts`（串行处理 + 注入 ChatRequestContext + 调用 runtime）
3) `package/src/runtime/agent/runtime.ts`（拼 system/history/user + 调用 LLM）
4) `package/src/runtime/tools/toolset.ts`（工具组装）
5) `package/src/runtime/tools/chat.ts`（`chat_send` 回发）
6) `package/src/runtime/chat/store.ts`（ChatStore 落盘与检索）
