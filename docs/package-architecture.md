# ShipMyAgent（package）架构说明（最新）：CLI × Server × Runtime × Tools × Adapters × Telemetry

本文档用于描述当前 `package/`（npm 包：`shipmyagent`）的**整体逻辑、文件组织逻辑、以及关键调用链路**。阅读目标：

- 从 CLI 启动链路，顺着看到 Server / Adapters 如何把消息交给 `AgentRuntime`
- 理解 Runtime 内部子系统（agent / chat / mcp / memory / storage / skills / context / prompts）的职责与依赖方向
- 理解“工具严格（tool-strict）”的消息回传方式：`chat_send` → dispatcher → adapter
- 定位所有“横切观测能力”（日志 + LLM 请求追踪）为何独立为 `telemetry/`

> 约定：本文以 `package/src`（TypeScript 源码）为准；`package/bin` 为编译产物镜像。

---

## 1. 目录分层与依赖方向（最重要）

### 1.1 总体分层

- `package/src/cli.ts`：CLI 入口（命令解析/默认行为）
- `package/src/commands/*`：命令实现（init/start/alias…）
- `package/src/server/*`：HTTP API Server + 静态文件（`.ship/public`）
- `package/src/adapters/*`：聊天平台适配器（Telegram / 飞书 / QQ）
- `package/src/runtime/*`：运行时核心子系统（AgentRuntime + chat/mcp/memory/storage/skills…）
- `package/src/telemetry/*`：横切观测（logger + LLM request tracing）
- `package/src/utils.ts`：路径/配置读取与工具函数（`.ship/*` 定位等）

### 1.2 推荐的依赖方向（“应该如此”）

```text
cli/commands
  -> server
  -> adapters
  -> runtime
  -> telemetry

adapters/server
  -> runtime
  -> telemetry

runtime/*
  -> telemetry (允许：观测横切)
  -> utils
  -/> adapters/server (禁止反向依赖)

runtime/tools/*
  -> runtime 子系统 (chat/storage/mcp/skills…)
  -> utils
  -/> runtime 子系统不应依赖 tools (避免倒置)
```

---

## 2. Runtime（运行时）模块关系：runtime/ 下到底有什么

`package/src/runtime` 是“真正的运行时”。目前包含：

- `runtime/agent/*`：AgentRuntime orchestrator（模型/提示词/工具/记忆/会话/执行流程）
- `runtime/chat/*`：聊天上下文（dispatcher、request context、chat store、幂等、输出收敛）
- `runtime/mcp/*`：MCP 管理（bootstrap/manager/types）
- `runtime/memory/*`：长期记忆（extractor/store）
- `runtime/context/*`：上下文压缩（ContextCompressor）
- `runtime/skills/*`：技能发现与 prompt 片段（Claude Code style skills）
- `runtime/storage/*`：文件与对象存储（`.ship/public` + S3/OSS 兼容）
- `runtime/prompts/*`：内置 prompt 集合
- `runtime/tools/*`：**模型可调用工具**（AI SDK `tool(...)` 定义与 toolset 组装）
- `runtime/index.ts`：runtime 对外聚合出口（并 re-export 部分 telemetry 类型/方法）

> 注意：`runtime/` 中不再包含 logging/llm-logging，这类横切能力都在 `telemetry/`。

---

## 3. Telemetry（观测）：为什么独立成 telemetry/

`package/src/telemetry/index.ts` 是唯一观测入口，提供两类能力：

### 3.1 结构化运行日志

- 实现：`telemetry/logging/*`
- 入口：`Logger` / `createLogger`
- 落盘：`.ship/logs/<YYYY-MM-DD>.jsonl`

### 3.2 LLM 请求追踪（跨 provider）

- 实现：`telemetry/llm-logging/*`
- `llmRequestContext` / `withLlmRequestContext({ chatKey, requestId }, fn)`
- `createLlmLoggingFetch(...)`：包装 fetch，把请求记录到 logger

设计意图：

- `runtime/` 专注“运行时领域子系统”，避免把观测实现混进 runtime 目录
- server/adapters/runtime 都统一使用同一个观测入口（避免多套 logger/trace）

---

## 4. Tools（工具层）：runtime/tools/* 是“模型能力边界”

### 4.1 工具与普通 util 的区别

`runtime/tools/*` 里的模块是“模型可调用能力”，表现为 AI SDK 的 `tool({ inputSchema, execute })`：

- `chat_send`：把消息发回用户（tool-strict 输出）
- `exec_shell`：在 projectRoot 下执行命令（仓库读写/搜索/测试等）
- `cloud_file_upload` / `cloud_file_url` / `cloud_file_delete`：上传/取 URL/删除（OSS 或 `.ship/public`）
- `s3_upload`：直接上传到 S3 兼容存储
- `skills_list` / `skills_load`：技能发现与加载
- MCP tools：由 MCP manager 动态注入（形如 `server:toolName`）

### 4.2 toolset 的组装入口

`runtime/tools/toolset.ts`：`createAgentToolSet(...)` 会：

1) `loadProjectDotenv(projectRoot)`
2) `setToolRuntimeContext({ projectRoot, config })`（给工具执行提供最小上下文）
3) 组装内置工具集合
4) 如存在 `mcpManager`，把 MCP tools 扩展到 tools map

### 4.3 AgentRuntime 如何拿到 toolset

`runtime/agent/tools.ts` 负责把 runtime/tools 的 toolset 注入到 AgentRuntime 初始化流程中：

- `createToolSet({ projectRoot, config, mcpManager, logger })`
- （可选）`executeToolDirect(...)` 用于代码路径直接调用工具

---

## 5. AgentRuntime 执行链路：一次消息如何跑完

核心类：`runtime/agent/runtime.ts`（`AgentRuntime`）

### 5.1 initialize()：启动时完成一次性装配

- 创建工具表：`runtime/agent/tools.ts` → `runtime/tools/toolset.ts`
- 创建模型与 agent：`runtime/agent/model.ts`（根据 provider 构造，并注入 `createLlmLoggingFetch`）
- 初始化会话与压缩器：`runtime/agent/session-store.ts` + `runtime/context/compressor.ts`
- 初始化记忆：`runtime/memory/store.ts`（落盘到 `.ship/memory`）

### 5.2 run(...)：每条指令/消息的执行过程（简化版）

1) 计算 `chatKey`
2) 召回记忆，拼接进 instructions（memory prompt section）
3) 构造最终 prompt（包含 requestId/chatKey 等）
4) `withChatRequestContext(...)` 注入 chat 上下文（供 `chat_send` 推断 channel/chatId/thread）
5) `withLlmRequestContext({ chatKey, requestId }, () => agent.generate(...))` 注入 LLM tracing 上下文
6) onStepFinish：抽取用户可见文本 + 工具摘要（用于流式/进度）
7) 写 LLM response block 到 logger（便于审计）
8) 更新 session history；必要时触发 context compaction
9) 周期性提取长期记忆（写入 `.ship/memory`）
10) 返回 `AgentResult`（success/output/toolCalls）

### 5.3 上下文超长处理

当捕获“context too long”类错误：

- 触发 `sessions.compactConversationHistory(...)`
- 最多尝试 3 次；失败则清空该 chatKey history 并提示用户重发

---

## 6. Chat 子系统：dispatcher / request context / store 的角色

目录：`runtime/chat/*`

关键组件：

- `request-context.ts`：AsyncLocalStorage（保存当前消息来源与 chat metadata）
- `dispatcher.ts`：注册/获取 dispatcher（adapter 把“发送能力”注册进来）
- `store.ts`：ChatStore（append-only 聊天日志：`.ship/chats/<chatKey>.jsonl`）
- `idempotency.ts`：幂等（防重复投递重复执行）
- `final-output.ts`：最终输出控制（需要时再补发最终文本）

---

## 7. Adapters：平台适配器与 tool-strict 输出

目录：`package/src/adapters/*`

适配器职责（不是实现 agent，而是“输入翻译 + 输出承接”）：

1) 平台入站事件 → 解析为统一的消息结构
2) 选择稳定的 `chatKey`
3) 调用 `AgentRuntime.run()`（并带上 `context`）
4) agent 若要回复用户，必须显式调用 `chat_send` 工具（tool-strict）

### 7.1 dispatcher 如何把 chat_send 路由回平台

- `PlatformAdapter` 构造时会 `registerChatDispatcher(channel, dispatcher)`
- `chat_send` 工具调用 `getChatDispatcher(channel).sendText(...)`
- dispatcher 再调用 adapter 的发送实现（Telegram/飞书/QQ 各自 SDK）

这保证了：

- Runtime/Agent 不需要知道平台差异
- “对外输出”必须通过工具显式发生，避免把内部推理/工具输出直接刷到群里

### 7.2 典型链路（平台消息 → Agent → 回发消息）

```text
Telegram/Feishu/QQ 入站消息
  -> Adapter 解析与 chatKey 选择
  -> append user message -> ChatStore(.ship/chats)
  -> AgentRuntime.run({ instructions, context })
  -> Agent 调用 chat_send 工具
       -> ChatDispatcher.sendText()
       -> Adapter sendTextToPlatform()
       ->（可选）把 bot 输出也 append 到 ChatStore
```

---

## 8. Server：HTTP API 与静态资源

目录：`package/src/server/*`

ServerContext 在 `start` 命令中组装，包含：

- `projectRoot`
- `logger`（telemetry）
- `agentRuntime`

server 提供：

- health/status 等基础 endpoint
- `/api/execute`：把 HTTP 指令转成 `AgentRuntime.run(...)`
- `/public/*`：安全地暴露 `.ship/public`（用于 cloud files public 模式）

---

## 9. MCP：把外部工具并入 agent 工具表

目录：`runtime/mcp/*`

启动链路：

- `start` 命令创建 `McpManager` 并 `bootstrapMcpFromProject(...)`
- `AgentRuntime` 初始化时把 `mcpManager` 注入 toolset
- toolset 将 MCP tools 挂到 `tools["server:toolName"]`
- agent 调用 `server:toolName` → `runtime/tools/mcp.ts` 转发到 `mcpManager.callTool(...)`

---

## 10. Storage：`.ship/public` 与 OSS(S3) 的统一抽象

目录：`runtime/storage/*`

- public 模式：复制到 `.ship/public`，由 server 的 `/public/*` 提供访问
- OSS 模式：S3-compatible（含 R2）上传/取 URL/删除（`storage/s3/*`）

工具层包装：

- `runtime/tools/cloud-files.ts`：`cloud_file_upload/url/delete`
- `runtime/tools/s3-upload.ts`：`s3_upload`

配置解析：

- `runtime/tools/oss.ts`：从 `ship.json` 的 `oss.*` 解析可用的 storage config

---

## 11. `.ship/` 运行目录：哪些数据落盘、为什么需要

（以当前代码实际使用为准）

- `.ship/logs/`：运行日志（JSONL）
- `.ship/chats/`：聊天日志（每 chatKey 一个 JSONL）
- `.ship/memory/`：长期记忆存储
- `.ship/mcp/`：MCP 相关状态/配置（由 bootstrap/manager 读写）
- `.ship/public/`：public 文件（cloud files public 模式）
- `.ship/.cache/`：缓存（例如幂等/中间态）

---

## 12. 快速定位：最短阅读路径

1) 启动链路：`package/src/commands/start.ts`
2) 执行主循环：`package/src/runtime/agent/runtime.ts`
3) 工具组装：`package/src/runtime/tools/toolset.ts`
4) tool-strict 输出：`package/src/runtime/tools/chat.ts` + `package/src/runtime/chat/dispatcher.ts`
5) MCP 注入：`package/src/runtime/mcp/manager.ts`
6) 观测入口：`package/src/telemetry/index.ts`

