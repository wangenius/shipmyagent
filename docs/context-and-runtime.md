# Context 工程与 Agent 执行时的上下文管理

更新时间：2026-02-04

本文聚焦两件事：
1) Agent 的 system prompt/运行时上下文是怎么拼出来的  
2) 执行过程中如何管理 history、如何“按需注入”更多上下文、日志如何关联到一次请求

## 1. system prompts：来自哪里、如何拼装

创建 runtime 的工厂：
- `createAgentRuntimeFromPath`：`package/src/core/agent/factory.ts:1`

拼装逻辑（systems 数组）：
- `Agent.md`（若不存在则用默认角色文本）
- 内置默认提示词：`DEFAULT_SHIP_PROMPTS`（来自 `package/src/core/agent/prompts.txt:1`）
- Skills 概览 section（扫描 `.claude/skills` 等路径）：`package/src/core/skills/prompt.ts:1`

这些最终通过：
- `transformPromptsIntoSystemMessages()`：`package/src/core/agent/prompt.ts:1`
转换为 `ToolLoopAgent.instructions`（system messages 列表）。

## 2. 每次 run 的“运行时 system prompt”（DefaultPrompt）

每次 `AgentRuntime.run()` 还会额外生成一个 per-request 的运行时 system prompt：

- `buildContextSystemPrompt()`：`package/src/core/agent/prompt.ts:1`

固定信息：
- projectRoot
- chatKey
- requestId

可选信息（如果当前调用链存在 chat request 上下文）：
- Channel / ChatId / UserId / Username
  - 读取自 `chatRequestContext`：`package/src/core/chat/request-context.ts:1`
  - 注入在 `package/src/core/agent/agent.ts:1`

同时该 DefaultPrompt 会写入 **用户可见输出规则**（例如要求用 `chat_send` 工具发送回复）。

## 3. in-flight messages 的组装（system + history + user 原文）

执行入口：
- `Agent.runWithToolLoopAgent()`：`package/src/core/agent/agent.ts:1`

每次请求的 messages 结构：
- `system`: DefaultPrompt（注意：它是“每次请求独有”的 system message）
- `history`: `AgentContextStore` 保存的 in-memory 历史（按 chatKey）
- `user`: 当前用户输入原文（不加前缀）

## 4. 会话历史管理：in-memory 与 on-disk 的分工

### 4.1 in-memory（短期上下文）

- `AgentContextStore`：`package/src/core/agent/context.ts:1`
- 特征：
  - 每个 `chatKey` 独立
  - 追加每轮 user + assistant/tool messages
  - 有固定上限（默认 60 条），超过裁剪最旧部分

### 4.2 on-disk（审计/可追溯历史）

- `ChatStore`：`package/src/core/chat/store.ts:1`
- `append()` 把入站 user 与出站 assistant（best-effort）写入 `.ship/chats/*.jsonl`
- 超阈值 archive：把旧的一半切到 `.archive-N.jsonl`

## 5. 按需历史注入：`chat_load_history`

工具：
- `chat_load_history`：`package/src/core/tools/builtin/chat-history.ts:1`

动机：
- 默认 in-memory history 受上限影响且可能不包含足够细节
- 需要更多上文时，让模型主动调用工具从 ChatStore 中加载

实现关键点：
- 注入发生在 **当前 user message 之前**，不改写用户原文
- 单次 run 有注入上限：
  - Agent 设置 `maxInjectedMessages: 120`：`package/src/core/agent/agent.ts:1`
  - 工具自身 `limit` 最大 200：`package/src/core/tools/builtin/chat-history.ts:1`

## 6. ToolExecutionContext：工具如何“拿到当前 messages”

工具执行上下文（ALS）：
- `ToolExecutionContext`：`package/src/core/tools/builtin/execution-context.ts:1`

Agent 在调用 `ToolLoopAgent.generate()` 前包裹：
- `withToolExecutionContext({ messages, currentUserMessageIndex, ... }, fn)`

这样 tool（如 `chat_load_history`）就能安全地对同一 in-flight messages 引用做“受控注入”。

## 7. 运行时日志与 LLM request 追踪

### 7.1 统一 Logger

- `Logger`：`package/src/telemetry/logging/logger.ts:1`
- 落盘：`.ship/logs/<YYYY-MM-DD>.jsonl`

### 7.2 LLM request/response 的关联方式

- request side：
  - `withLlmRequestContext({chatKey, requestId}, ...)`：`package/src/core/agent/agent.ts:1`
  - provider fetch wrapper 记录请求：`package/src/telemetry/llm-logging/fetch.ts:1`
- response side：
  - Agent 在 `generate()` 返回后记录 response messages block：`package/src/core/agent/agent.ts:1`

开关：
- `SMA_LOG_LLM_MESSAGES=0` 或 `ship.json llm.logMessages=false`：`package/src/core/agent/model.ts:1`
- `SMA_LOG_LLM_PAYLOAD=1` 记录更敏感的 payload：`package/src/telemetry/llm-logging/format.ts:1`

## 8. 上下文过长（context window exceeded）时的策略

`Agent.run()` 捕获错误文本包含 context window 相关关键词后：
- 记录 warn 日志
- 进行“最小压缩”：丢弃最旧一半的 in-memory history
- 最多重试 3 次，仍失败则清空该 chatKey 的 history 并返回失败信息

实现位置：
- `package/src/core/agent/agent.ts:1`

