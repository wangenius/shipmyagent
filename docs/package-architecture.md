# `package/` 模块与架构总览

更新时间：2026-02-04

本文从“模块边界/职责”角度，说明 `package/src` 的整体分层，帮助你快速定位：
- Agent Runtime（大脑）在哪里
- Tools（手脚）如何组装并注入上下文
- Adapters（平台接入）如何把消息喂给 runtime 并完成回发
- Server 与 Telemetry 怎么串起来

## 1. 顶层目录结构（`package/src`）

`package/src` 关键目录：

- `core/`：运行时核心域（agent/chat/tools/skills/mcp）
- `adapters/`：平台适配器（Telegram/Feishu/QQ）与统一的排队串行模型
- `server/`：HTTP server + 交互式 Web UI（独立端口代理）
- `telemetry/`：统一日志 + LLM request 追踪（跨模块横切关注点）
- `types/`：对外/跨模块复用的类型定义
- `commands/`：CLI 子命令（`init/start/alias`）

## 2. 公共入口（`core/index.ts`）

`package/src/core/index.ts:1` 是 runtime 的“公共 surface”（内部包 API）：

- Agent：`AgentRuntime` / `createAgentRuntimeFromPath`
- Telemetry：`Logger` / `getLogger` / `withLlmRequestContext` 等
- 子系统：`chat` / `mcp` / `skills`

目标是：让上层（server/adapters/commands）通过少量稳定入口使用核心能力，避免模块之间互相穿透。

## 3. Agent Runtime（大脑）

核心文件：`package/src/core/agent/agent.ts:1`

### 3.1 运行模型

- 使用 AI SDK 的 `ToolLoopAgent` 作为“循环式工具调用”执行器。
- 每次 `run()` 会：
  - 生成 requestId
  - 组装 system prompt（见 `prompt.ts`）
  - 组装 in-flight messages（system + in-memory history + user message）
  - 执行 tool loop 并记录 LLM request/response（见 telemetry）

### 3.2 会话内存（按 chatKey 隔离）

`AgentContextStore`：`package/src/core/agent/context.ts:1`

- `Map<chatKey, ModelMessage[]>` 管理每个会话的 in-memory history。
- 运行中会将每轮 `user` + `assistant/tool` response 追加进 history。
- 有简单上限裁剪（默认 60 条），避免无边界膨胀。

> 注意：ChatStore 的落盘历史属于另一个层（`core/chat/store.ts`），不是 AgentContextStore 的职责。

## 4. Tools（手脚）与组装方式

工具集组装：`package/src/core/tools/set/toolset.ts:1`

默认会拼入：

- `chat_send`：回发消息（严格走 dispatcher）
- `chat_load_history`：按需把 `.ship/chats/*.jsonl` 的历史注入当前上下文
- `chat_contact_*`：联系人簿 lookup/send（跨平台 best-effort）
- `skills_list/skills_load`：Claude Code 兼容 skills 的发现与加载
- `exec_shell`：对仓库的读写/搜索/执行的统一出口
- MCP tools：从 `.ship/mcp` 启动并注册到 toolset

工具运行时需要的最小上下文（projectRoot/config）通过一个轻量 store 提供：
- `package/src/core/tools/set/runtime-context.ts:1`

## 5. Chat 子系统（消息落盘/路由）

### 5.1 ChatStore（审计与历史数据）

`package/src/core/chat/store.ts:1`

- append-only 写入 `.ship/chats/<chatKey>.jsonl`
- 提供：
  - `loadRecentEntries/loadRecentMessages`
  - `search(keyword)`
  - archive（超过阈值时分卷）

### 5.2 Dispatcher registry（回发路由）

`package/src/core/chat/dispatcher.ts:1`

- 维护 `Map<channel, dispatcher>`。
- `chat_send` 工具在运行时根据当前请求上下文决定发往哪个 dispatcher。

## 6. Adapters（平台接入层）

核心抽象：

- `PlatformAdapter`：`package/src/adapters/platform-adapter.ts:1`
  - 在构造函数里注册 dispatcher（让 `chat_send` 可用）
  - 提供 `sendToolText`：平台回发 + best-effort 落盘 assistant 记录
- `BaseChatAdapter`：`package/src/adapters/base-chat-adapter.ts:1`
  - 统一把入站消息落盘（user 记录）
  - best-effort 更新联系人簿（username → 最新 delivery target）
  - 进入全局队列（QueryQueue）串行执行 agent
- `QueryQueue`：`package/src/adapters/query-queue.ts:1`
  - **全局单队列并发=1**，跨用户/跨平台严格串行

平台实现：
- Telegram：`package/src/adapters/telegram/bot.ts:1`
- Feishu：`package/src/adapters/feishu.ts:1`
- QQ：`package/src/adapters/qq.ts:1`

## 7. Server（HTTP API + 交互式 Web）

- 主 server：`package/src/server/index.ts:1`
  - `/api/execute`：以 `api:chat:<chatId>` 的 chatKey 执行一次 `AgentRuntime.run()`
  - 同时将 user/assistant 结果写入 ChatStore
- 交互式 Web server：`package/src/server/interactive.ts:1`
  - 独立端口提供静态 UI
  - 将 `/api/*` 代理到主 server

## 8. Telemetry（统一日志与 LLM request 追踪）

- Logger：`package/src/telemetry/logging/logger.ts:1`
  - JSONL 落盘 `.ship/logs/<YYYY-MM-DD>.jsonl`
- LLM request logging：
  - Context ALS：`package/src/telemetry/llm-logging/context.ts:1`
  - Fetch wrapper：`package/src/telemetry/llm-logging/fetch.ts:1`
  - 记录格式解析：`package/src/telemetry/llm-logging/format.ts:1`

开关逻辑在 model 工厂中：
- `package/src/core/agent/model.ts:1`

