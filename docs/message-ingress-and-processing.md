# 消息进来之后是如何处理的（Ingress → Runtime → Reply）

本文档回答一个具体问题：**一条消息进入 ShipMyAgent 之后，会经历哪些环节？每个环节的数据结构（类型）是什么样的？**

范围：
- Chat 平台：Telegram / 飞书 / QQ（“tool-strict”模式）
- HTTP API：`POST /api/execute`

> 约定：本文以 `package/src` 源码为准。

---

## 0. 一句话总览

**平台消息** → Adapter 解析 → 计算 `chatKey`（会话隔离）→ 记录 `ChatStore`（落盘审计）→ 进入全局 `QueryQueue`（并发=1）→ `AgentRuntime.run()`（每次请求拼一个 system：`Agent.md + DefaultPrompt`，并带上 in-memory history + 本轮 user 原文）→ 模型按需调用 `chat_load_history` 补充历史 → 模型调用 `chat_send`（通过 dispatcher 发回平台）→ 若模型忘了发，则 fallback 发送最终 `output`。

---

## 1. 关键角色（模块）与职责

- Adapter（平台适配器）：接收平台消息、生成 `chatKey`、写入 ChatStore、调用 AgentRuntime、把回复发回平台  
  - 例：`package/src/adapters/telegram/bot.ts`
  - 基类：`package/src/adapters/base-chat-adapter.ts`
- `ChatStore`（聊天日志）：append-only 记录每条 user/assistant 消息到 `.ship/chats/*.jsonl`；同时提供“读取最近消息/搜索历史”的能力（供工具按需加载）  
  - `package/src/runtime/chat/store.ts`
- `AgentRuntime`（运行时编排）：构建 per-request system、维护 in-memory session history、运行 `ToolLoopAgent`、收集 toolCalls  
  - `package/src/runtime/agent/runtime.ts`
- dispatcher registry：把“发消息能力”从 adapter 暴露给工具 `chat_send`  
  - `package/src/runtime/chat/dispatcher.ts`
- `chat_send` 工具：模型用它把“用户可见输出”发回平台（tool-strict）  
  - `package/src/runtime/tools/chat.ts`
- `chat_load_history` 工具：模型需要更多上文时，按需从磁盘读取历史消息并注入到“当前 in-flight messages”（不改 user 原文）  
  - `package/src/runtime/tools/chat-history.ts`
- ToolExecutionContext：一次 agent run 期间，工具用于“注入历史消息”的运行时上下文（AsyncLocalStorage）  
  - `package/src/runtime/tools/execution-context.ts`
- final-output fallback：模型没调用 `chat_send` 时，adapter 用 `result.output` 兜底发送  
  - `package/src/runtime/chat/final-output.ts`

---

## 2. Chat 平台：消息处理链路（逐环节 + 类型）

下面按“消息从平台进来，到回到平台”的顺序描述（Telegram/飞书/QQ 都遵循这套架构）。

### 2.1 平台入口：Adapter 收到消息

不同平台入口不同，但 adapter 最终会把“用户文本指令”整理成统一结构。

在 `BaseChatAdapter` 的语义里，一个进入 runtime 的消息长这样：

**IncomingChatMessage**

来自：`package/src/adapters/base-chat-adapter.ts`

```ts
export type IncomingChatMessage = {
  chatId: string;
  text: string;
  chatType?: string;
  messageId?: string;
  messageThreadId?: number;
  userId?: string;
  username?: string;
};
```

解释：
- `chatId`：平台会话 ID（群/私聊/频道等）
- `text`：用户输入（会作为 `instructions` 送入 AgentRuntime）
- `messageThreadId`：线程/话题（Telegram topics 等）；用于做 `chatKey` 隔离
- `actorId/actorUsername`：群聊中识别“当前说话的人”

#### 2.1.1 `messageId` 是什么？（以 Telegram 为例）

`IncomingChatMessage.messageId` 代表“**平台原始消息的 ID**”，用于：
- 写入 `.ship/chats/*.jsonl` 时关联原消息（便于审计与排查）
- 回发消息时做“reply-to”（部分平台/场景会用到）

在 Telegram 中：
- `message_id` 是一个 **整数**，在同一个 `chat_id` 里递增且唯一
- **无论这条消息是文本 / 语音 / 图片 / 文件 / 表情**，它都有自己的 `message_id`
- 注意：它不是附件的 `file_id`（语音/图片/文件都有各自的 `file_id`）

因此在 runtime 里你会看到两类 ID：
- `messageId`：对话里“这条消息”的 id（例如 `"12345"`）
- `fileId`：附件对象的 id（例如 `"AwACAgUAAxkBAAIB..."`），仅在 Telegram adapter 内部处理附件时出现

> 当前 `IncomingChatMessage` 里只显式携带 `messageId`；附件（voice/photo/document 等）的 `file_id` 并不在这个统一结构里，而是由 Telegram adapter 自己在接入层解析/下载/转写后再把内容拼进 `text` 或作为独立流程处理。

### 2.2 计算 chatKey：决定“上下文隔离粒度”

Adapter 会根据 `chatId/chatType/messageThreadId/...` 生成一个**稳定的** `chatKey`，用于：
- 运行时的会话内存隔离（不同 chatKey 不共享历史）
- `.ship/chats/<chatKey>.jsonl` 的落盘文件名隔离

基类里会在 `runAgentForMessage()` 里计算 chatKey：见 `package/src/adapters/base-chat-adapter.ts`。

> 具体 `getChatKey()` 的规则属于各平台 adapter 的实现细节。

#### 2.2.1 为什么不直接让 `chatKey === chatId`？

“只用 chatId”在**私聊**里通常够用，但在工程上很容易踩坑：

1) **跨平台冲突**：Telegram 的 `chatId` 可能和 QQ 的 `chatId` 只是数字/字符串，直接用会撞 key。  
   常见做法是把 platform 也纳入 key（例如 `telegram:<chatId>`）。

2) **群聊 thread/topic 隔离**：Telegram topics（`messageThreadId`）如果不进 key，会把多个话题的上下文混在一起。  
   常见做法是 `telegram:<chatId>:thread:<messageThreadId>`。

3) **chatId 语义不是“用户”**：群聊时 chatId 是 group id，不是某个用户 id。你如果希望“按用户隔离”，就不能只用 chatId。

结论：
- 你可以把 **默认策略** 定成 “chatKey==chatId”，但一旦进入群聊/thread/多平台，就会需要更强的 key。
- 推荐把 `chatKey` 当作“运行时内部的会话 key”，可以与 `chatId` 相同，但不强制相同。

### 2.3 全局 QueryQueue：单线程处理所有用户消息

ShipMyAgent 现在采用“一个活着的大脑”的简化实现：

- **全局只有一个 QueryQueue**：所有平台、所有用户的消息都入队，严格按顺序处理（并发=1）
- **全局只有一个 AgentRuntime**：作为唯一的 agent brain；不同用户/会话通过 `chatKey` 做上下文隔离

实现：
- 队列：`package/src/adapters/query-queue.ts`
- 入队：`package/src/adapters/base-chat-adapter.ts`

---

### 2.9 场景化：一条 Telegram 群聊（topic）消息是怎么“流转”的？

这里用一个具体场景把“调用顺序、类型、依赖关系”串起来。

#### 场景 A：用户在群聊 topic 里发一句话

假设：
- 平台：Telegram
- 群聊：`chatId = "-1001234567890"`
- topic：`messageThreadId = 42`
- 用户发送文本：`"帮我总结一下这份报告的核心观点"`

##### A1) Adapter 入口：归一化 Ingress 结构

Telegram adapter 会把平台事件解析成 `IncomingChatMessage`（基类语义）：

```ts
export type IncomingChatMessage = {
  chatId: string;
  text: string;
  chatType?: string;
  messageId?: string;
  messageThreadId?: number;
  userId?: string;
  username?: string;
};
```

随后调用基类逻辑：
1) 计算 `chatKey`（决定“上下文隔离粒度”）
2) 把 user 消息写入 `ChatStore.append(...)`（落盘审计）
3) 把消息入队到全局 `QueryQueue`

##### A2) ChatStore：落盘审计（append-only）

写入 `.ship/chats/<chatKey>.jsonl` 的结构是：

```ts
export interface ChatLogEntryV1 {
  v: 1;
  ts: number;
  channel: "telegram" | "feishu" | "qq" | "api" | "cli" | "scheduler";
  chatId: string;
  chatKey: string;
  userId?: string;
  messageId?: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  meta?: Record<string, unknown>;
}
```

> 关键点：落盘的是“审计日志”，不是“LLM 上下文”。上下文怎么拼由 runtime 决定。

##### A3) QueryQueue：串行执行 + 注入 ChatRequestContext

当轮到该消息处理时，`QueryQueue.processOne(...)` 会用 `withChatRequestContext(...)` 把路由信息注入到 AsyncLocalStorage：

```ts
export type ChatRequestContext = {
  channel?: "telegram" | "feishu" | "qq" | "cli" | "scheduler" | "api";
  chatId?: string;
  messageThreadId?: number;
  chatKey?: string;
  userId?: string;
  chatType?: string;
  username?: string;
  messageId?: string;
};
```

然后调用：

```ts
await runtime.run({ chatKey, instructions: msg.text })
```

##### A4) AgentRuntime.run：默认上下文拼装（system = Agent.md + DefaultPrompt）

从 v2 开始，runtime 每次请求都会拼一个新的 system message（避免把 per-request 信息写进 history），并把 user 原文保持原样：

1) `system`：`Agent.md`（项目指令）+ `DefaultPrompt`（运行时元信息 + 输出规则）
2) `history`：同一进程内的 in-memory session（user/assistant/tool）
3) `user`：用户原文（不加前缀）

对应使用到的关键类型（AI SDK）：

```ts
import type { ModelMessage } from "ai";
// { role: "system" | "assistant" | "user" | "tool", content: ... }
```

落盘历史位置（供按需加载）：
- `.ship/chats/<chatKey>.jsonl`（`ChatStore`）

##### A5) ToolLoopAgent.generate：工具循环（可按需加载历史）

生成过程里，runtime 会用 `withToolExecutionContext(...)` 注入“本次 run 的可变 messages 引用”，让工具可以把历史消息插入到当前上下文里：

```ts
export type ToolExecutionContext = {
  messages: ModelMessage[];
  currentUserMessageIndex: number;
  injectedFingerprints: Set<string>;
  maxInjectedMessages: number;
};
```

这使得模型可以采取两段式策略：

1) 先根据 in-memory history + 当前问题做判断
2) 若发现信息不足，再调用 `chat_load_history` 获取更多上文

##### A6) chat_load_history：把历史消息“注入”到当前上下文

当模型调用：

```ts
await chat_load_history({ limit: 30, keyword?: "xxx" })
```

工具会：
1) 从 `ChatStore` 读取/搜索 `.ship/chats/<chatKey>.jsonl`
2) 过滤出 `user/assistant` 消息
3) 把消息插入到 `currentUserMessageIndex` 之前（保证 user 原文不被篡改）

> 这一步是“把更多上文作为 context 提供给模型”，不是把它发给用户。

##### A7) chat_send：把最终回复回发到平台（tool-strict）

模型最终应该调用：

```ts
await chat_send({ text: "..." })
```

`chat_send` 会从 `ChatRequestContext` 读到 `channel/chatId/...`，通过 dispatcher 调用对应 adapter 的 `sendTextToPlatform(...)`。

并且 adapter 会把 assistant 消息同样 append 到 `.ship/chats/<chatKey>.jsonl`（用于审计/检索）。

##### A8) Fallback：模型忘记 chat_send 时兜底发一次

如果模型没有调用 `chat_send`，QueryQueue 会调用 `sendFinalOutputIfNeeded(...)`：
- 已经发过则不重复发
- 否则把 `AgentResult.output` 直接回发到平台，避免“模型答了但用户收不到”

---

### 2.10 场景化：第二轮对话为什么不会默认加载完整历史？

假设用户紧接着又问：
> “把第二点展开，给我一个更详细的大纲”

运行时默认仍然不会把“落盘完整历史”加载进来（只使用 in-memory session history），原因：
1) **成本可控**：避免每轮都把 `.jsonl` 历史读出来塞给模型
2) **质量可控**：历史太长往往会稀释当前任务焦点
3) **策略外置**：由模型自己决定什么时候需要更多上文，并通过 `chat_load_history` 明确触发

如果模型认为上文不够，它可以：
- 直接 `chat_load_history({ limit: 80 })`
- 或用 `chat_load_history({ keyword: "报告", limit: 40 })` 先做定向检索

---

### 2.11 依赖逻辑（层次与边界）

把工程按“依赖方向”抽象成 3 层，便于理解为什么要用 tool/context 这类机制：

#### Runtime Subsystems（底层：状态/存储/路由）

- `runtime/chat/*`：ChatStore、dispatcher registry、request context

特点：
- 不依赖 tools（避免循环依赖）
 - 为上层提供可复用能力（存取、路由）

#### Tools（中层：暴露给模型的能力）

- `runtime/tools/*`
- 工具通过 AsyncLocalStorage 获取运行时信息（例如 `ChatRequestContext` / `ToolExecutionContext` / `ToolRuntimeContext`）

特点：
- 可以依赖 runtime subsystems（例如 `ChatStore`）
- 不应该反向让 runtime subsystems 依赖 tools

#### Adapters / Server（上层：入口与平台集成）

- `adapters/*`：平台入口、消息解析、chatKey 规则、dispatcher 注册
- `server/*`：HTTP 入口与路由

特点：
- 依赖 runtime（调用 runtime.run，写 ChatStore）
- 通过 dispatcher 把“回发能力”暴露给 tools（模型只需调用 `chat_send`）

### 2.4 记录用户消息（落盘审计）

Adapter 会把用户消息 append 到 `.ship/chats/<chatKey>.jsonl`。

**ChatLogEntryV1**

来自：`package/src/runtime/chat/store.ts`

```ts
export interface ChatLogEntryV1 {
  v: 1;
  ts: number;
  channel: "telegram" | "feishu" | "qq" | "api" | "cli" | "scheduler";
  chatId: string;
  chatKey: string;
  userId?: string;
  messageId?: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  meta?: Record<string, unknown>;
}
```

Adapter 写入时通常是：
- `channel`: 平台名（telegram/feishu/qq）
- `role`: `"user"`
- `text`: 用户原文
- `meta`: `chatType/messageThreadId/actorUsername` 等平台细节

写入点（基类）：`package/src/adapters/base-chat-adapter.ts`

### 2.5 默认上下文：system = Agent.md + DefaultPrompt

从 v2 开始，runtime 的 system message 由两部分拼成：

- `Agent.md`：项目/仓库的长期指令（人类写给 agent 的规则与偏好）
- `DefaultPrompt`：运行时元信息 + 输出规则（要求用 `chat_send` 回发；不允许给 user 文本加前缀）

历史上下文默认来自 runtime 的 in-memory session（同一进程内连续对话）。当模型需要更多“落盘历史细节”时，它可以显式调用 `chat_load_history` 工具，从 `.ship/chats/<chatKey>.jsonl` 按需读取/搜索历史，并把消息注入到当前 in-flight 上下文（插入到当前 user 消息之前）。

### 2.6 构造 AgentRunInput：runtime 只需要 chatKey + instructions

Adapter 不再把平台细节塞进 Agent 的输入结构。`AgentRuntime.run(...)` 只需要两样东西：

**AgentRunInput**

来自：`package/src/runtime/agent/types.ts`

```ts
export interface AgentRunInput {
  chatKey: string;
  instructions: string;
  onStep?: (event: { type: string; text: string; data?: Record<string, unknown> }) => Promise<void>;
}
```

平台相关字段（channel/chatId/messageId/threadId/userId/username 等）会由 adapter 在执行时注入到 `ChatRequestContext`（AsyncLocalStorage），供 `chat_send` 工具做回发路由。

### 2.7 进入 AgentRuntime：拼上下文 + 跑 ToolLoopAgent

`AgentRuntime.run()` 的核心流程：

1) 构造 per-request `system` message：`Agent.md + DefaultPrompt`
2) 从 session 取出 in-memory history（user/assistant/tool）
3) 组装 in-flight messages：`system + history + user(原文)`
4) 以 `withToolExecutionContext(...)` 包住一次 `ToolLoopAgent.generate({ messages })` 调用  
   - 使得工具（如 `chat_load_history`）可以把更多历史消息注入到当前 in-flight messages
5) 将本轮 user + LLM response messages 追加到 session history（并做简单长度裁剪）
6) 收集 steps/toolResults，组装 `AgentResult`

实现：`package/src/runtime/agent/runtime.ts`

### 2.8 tool-strict 回发：模型调用 chat_send（推荐）

模型要发回用户可见消息，应调用工具 `chat_send`。

`chat_send` 的入参 schema（可当作“类型”使用）：

来自：`package/src/runtime/tools/chat.ts`

```ts
{
  text: string;
}
```

发消息实际走的链路：

1) `chat_send` 从 `ChatRequestContext`（AsyncLocalStorage）拿到默认平台与 chatId 等上下文
2) 找到 dispatcher：`getChatDispatcher(channel)`
3) 调用 dispatcher 的 `sendText(...)`

其中 dispatcher 是 adapter 在构造时注册的：
- `registerChatDispatcher(channel, { sendText: ... })`：`package/src/adapters/platform-adapter.ts`
- registry：`package/src/runtime/chat/dispatcher.ts`

### 2.9 兜底回发：模型没调用 chat_send 时，自动发送最终 output

现实中模型有时会只生成纯文本 `result.output` 而忘了调用 `chat_send`。为了避免“用户收不到消息”，adapter 会兜底：

- 如果 toolCalls 里有成功的 `chat_send`：不重复发送
- 否则：直接通过 dispatcher 发送 `result.output`

实现：`sendFinalOutputIfNeeded(...)`：`package/src/runtime/chat/final-output.ts`

调用点示例：
- Telegram：`package/src/adapters/telegram/bot.ts`
- 飞书：`package/src/adapters/feishu.ts`
- QQ：`package/src/adapters/qq.ts`

### 2.10 AgentRuntime 的返回值：AgentResult

**AgentResult**

来自：`package/src/runtime/agent/types.ts`

```ts
export interface AgentResult {
  success: boolean;
  output: string;
  toolCalls: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: string;
  }>;
}
```

解释：
- `output`: 模型最终的纯文本输出（用于 CLI/API；在 chat 场景通常仅作为 fallback）
- `toolCalls`: runtime 观测到的工具调用摘要（用于审计、debug、fallback 判断）

---

## 3. HTTP API：`POST /api/execute` 的处理链路（逐环节 + 类型）

HTTP 入口在 server：
- `package/src/server/index.ts` 的 `POST /api/execute`

### 3.1 请求体（隐式类型）

`/api/execute` 期望 JSON body 至少包含：

```ts
{
  instructions: string;
  chatId?: string;     // 默认 "default"
  userId?: string;     // 或 actorId（用于记录）
  actorId?: string;
  messageId?: string;
}
```

### 3.2 记录 user 消息

server 会将用户消息 append 到 ChatStore（channel=api），其中：
- `chatKey` 被构造为：`api:chat:${chatId}`

### 3.3 执行 AgentRuntime.run

server 复用一个全局 `agentRuntime`（ServerContext 注入）：

```ts
agentRuntime.run({
  chatKey,
  instructions,
})
```

### 3.4 记录 assistant 输出并返回 JSON

server 把 `result.output` 作为 assistant 消息再次 append 到 ChatStore（role=assistant），然后把整个 `AgentResult` JSON 返回给调用方。

注：API 场景没有 `chat_send` 的必要（返回 HTTP response 就能交付结果）。

---

## 4. 附：请求上下文（ChatRequestContext）的类型

`chat_send` 之所以能“默认回到用户当前平台”，是因为 runtime 在调用模型时使用 AsyncLocalStorage 注入了请求上下文。

**ChatRequestContext**

来自：`package/src/runtime/chat/request-context.ts`

```ts
export type ChatRequestContext = {
  channel?: "telegram" | "feishu" | "qq" | "cli" | "scheduler" | "api";
  chatId?: string;
  messageThreadId?: number;
  chatKey?: string;
  userId?: string;
  chatType?: string;
  username?: string;
  messageId?: string;
};
```

---

## 5. 最常见的两个“你会踩的坑”

1) **`chatId` vs `userId`**  
   `chatId` 是“对话发生的地方”（群/私聊/频道）；`userId` 是“当前说话的人”（群聊里才有意义）。

2) **重复发消息**  
   如果模型忘了调用 `chat_send`，系统会兜底发送 `AgentResult.output`；一旦你自行在 adapter 里也发了消息，要注意避免双发。
