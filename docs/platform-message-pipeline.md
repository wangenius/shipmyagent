# Platform 与消息链路（adapter → queue → context → tool/dispatcher）

更新时间：2026-02-04

本文从“消息从哪里来、怎么被处理、怎么被回发”角度，描述 `package/` 当前的 platform/message 实现方式，并指出 API/非 chat 模式下的差异。

## 1. 核心概念

- **channel**：平台通道（telegram/feishu/qq 等），用于回发路由
- **chatId**：平台侧会话标识（群/私聊/频道/话题等）
- **chatKey**：ShipMyAgent 内部的稳定会话 key，用于隔离会话内存与落盘历史
- **dispatcher**：每个平台注册一个“发送能力”（sendText），由工具统一调用

关键类型：
- `ChatRequestContext`：`package/src/core/chat/request-context.ts:1`
- `ChatDispatchChannel`：`package/src/core/chat/dispatcher.ts:1`

## 2. 入站链路：平台消息如何进入 runtime

### 2.1 平台适配器的共同抽象

- `PlatformAdapter`：`package/src/adapters/platform-adapter.ts:1`
  - 构造时注册 dispatcher（见 4.1）
  - 持有 `ChatStore`，用于落盘 user/assistant 消息

- `BaseChatAdapter`：`package/src/adapters/base-chat-adapter.ts:1`
  - 将平台原始消息标准化为 `IncomingChatMessage`
  - `appendUserMessage()`：写入 `.ship/chats/*.jsonl`
  - `enqueueMessage()`：进入全局队列
  - best-effort 更新联系人簿（username → delivery target）

### 2.2 串行执行模型（全局单队列）

`QueryQueue`：`package/src/adapters/query-queue.ts:1`

特征：
- 跨平台、跨 chatKey、跨用户：**全局 concurrency=1**
- 队列中后续消息会发送一次 “我在处理上一条请求…” 的 busy ack（同 chatKey 30s 冷却）

为什么这么做：
- 工具（如 `exec_shell`）具有副作用，串行能显著降低竞态/并发写冲突
- 让日志与执行轨迹更可审计（按时间线顺序）

## 3. “当前消息来自哪个平台”的上下文注入

`QueryQueue.processOne()` 会在调用 `AgentRuntime.run()` 前包一层：

- `withChatRequestContext(...)`：`package/src/core/chat/request-context.ts:1`

这样在同一 async 调用链里：
- `chat_send` 可以知道要回发到哪个 channel/chatId
- Agent Runtime 能把 channel/chatId/userId/username 写进系统提示词（见 `package/src/core/agent/agent.ts:1`）

## 4. 出站链路：tool-strict 发送与 fallback

### 4.1 tool-strict 主路径：`chat_send`

`chat_send`：`package/src/core/tools/builtin/chat.ts:1`

- 从 `chatRequestContext` 读取 channel/chatId（以及 messageThreadId/chatType/messageId）
- 通过 `getChatDispatcher(channel)` 获取 dispatcher
- 调用 `dispatcher.sendText(...)`

### 4.2 dispatcher 注册表（平台发送能力注册）

dispatcher registry：
- `registerChatDispatcher/getChatDispatcher`：`package/src/core/chat/dispatcher.ts:1`

注册发生在：
- `PlatformAdapter` 构造函数：`package/src/adapters/platform-adapter.ts:1`

结论：**平台适配器启动时**就把 “怎么发消息” 注册到了 core/chat，工具只管路由，不需要知道平台 SDK。

### 4.3 fallback：模型忘记调用工具时兜底发送

`sendFinalOutputIfNeeded`：`package/src/core/chat/final-output.ts:1`

行为：
- 若 toolCalls 中已有成功的 `chat_send`，则避免重复发送
- 否则把 agent 的最终 `output` 再发一次

该 fallback 只在 `QueryQueue` 内调用：`package/src/adapters/query-queue.ts:1`。

## 5. 去重（避免同一 messageId 触发多次执行）

通用的持久化去重工具：
- `tryClaimChatIngressMessage`：`package/src/core/chat/idempotency.ts:1`

Telegram 使用该机制（见 `package/src/adapters/telegram/bot.ts:1`）；Feishu/QQ 同时存在各自的内存/半持久化去重实现（细节在各 adapter 文件中）。

## 6. API 模式的差异（重要）

`/api/execute`：`package/src/server/index.ts:1`

现状：
- 会写 ChatStore（channel=api），并直接返回 `AgentRuntime.run()` 的结果
- 但没有设置 `withChatRequestContext`
- dispatcher registry 也不包含 `"api"` channel（`ChatDispatchChannel` 目前仅 `telegram|feishu|qq`）

影响：
- 若 system prompt 强制 “必须用 chat_send 回复”，则 API 模式下 `chat_send` 会失败（无 channel/chatId）
- API 依赖最终 `output` 返回，而不是 `chat_send` 回发

建议见 `docs/risk-and-recommendations.md`。

