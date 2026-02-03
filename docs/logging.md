# Agent 执行日志与审计数据（当前实现）

本文解释 ShipMyAgent 当前版本“执行过程”的日志与审计数据分别写到哪里、记录哪些内容、如何开关，以及常见排查路径。

> 代码入口（建议配合阅读）：
> - 系统 Logger：`package/src/runtime/logging/logger.ts`
> - Agent Logger：`package/src/runtime/agent/agent-logger.ts`、`package/src/runtime/agent/runtime.ts`
> - LLM 请求日志：`package/src/runtime/llm-logging/*`、`package/src/runtime/agent/model.ts`
> - 对话日志（ChatStore）：`package/src/runtime/chat/store.ts`
> - Runs：`package/src/runtime/run/*`
> - Approvals：`package/src/runtime/permission/approvals-store.ts`

---

## 1. `.ship/` 下的“审计数据”总览

初始化（`shipmyagent init`）会创建 `.ship/` 目录结构（见 `package/src/commands/init.ts`、`package/src/utils.ts`）：

```
.ship/
  logs/         # 日志（系统 Logger + Agent Logger + LLM 请求/响应）
  chats/        # 对话消息（jsonl，可归档）
  runs/         # 每次 run 的状态与输出（json）
  queue/        # run 队列 token（pending/running/done）
  approvals/    # 待审批与审批记录（json）
  tasks/        # 任务定义（.md）
  .cache/       # 运行缓存（含 ingress 去重等）
  memory/       # 长期记忆（见 memory/store）
  public/       # 对外可访问文件（可配 cloud files）
  mcp/          # MCP 配置（mcp.json + schema）
```

> 其中“执行过程”的可追溯性主要由 `logs/`、`chats/`、`runs/`、`approvals/` 四类数据共同构成。

---

## 2. 统一 Logger（系统层 + Agent 执行层）

当前版本已统一为一套 `Logger`（见 `package/src/runtime/logging/logger.ts`），同时满足：

- 系统层（server / scheduler / run worker 等）使用的 `info/warn/error/debug/action/approval`
- Agent/LLM 日志需要的 `logger.log(level, message, details?)`（异步）

### 2.1 落盘位置与格式

- 文件：`.ship/logs/<YYYY-MM-DD>.jsonl`
- 格式：每行一个 JSON 对象（包含 `timestamp/type/message/details/...`）
- 落盘策略：**每条日志都会 append**（不再区分 warn/error 立即写、退出时再批量写）

### 2.2 控制台输出

- 仍保留彩色输出
- debug 是否打印由创建 logger 时的 `logLevel` 控制（例如 `createLogger(projectRoot, "debug")`）

---

## 3. LLM 请求/响应是如何被记录的？

### 3.1 请求：通过 `fetch` hook 记录

`createModelAndAgent` 会创建一个带日志能力的 `fetch`（见 `package/src/runtime/agent/model.ts`）：

- `SMA_LOG_LLM_MESSAGES`（环境变量）或 `ship.json` 的 `llm.logMessages` 控制是否启用
  - 环境变量优先：`"0"` 表示关闭，其他值表示开启
  - 未配置时默认开启（`true`）

启用后，每次向 LLM provider 发请求都会调用 `Logger.log("info", ...)` 写入 `.ship/logs/<date>.jsonl`。

> 注意：当前的“请求日志文本”里通常会包含 system prompt 与 messages（见 `package/src/runtime/llm-logging/format.ts`），可能包含敏感内容；生产环境建议按需关闭或做脱敏。

### 3.2 payload：可选写入 meta

`SMA_LOG_LLM_PAYLOAD` 控制是否把完整 `payload` 放进 `meta.payload` 字段（见 `package/src/runtime/llm-logging/format.ts`）。

### 3.3 响应：在 AgentRuntime 里额外记录

在 `AgentRuntime.runWithToolLoopAgent` 中，会把 `result.response.messages` 格式化成文本块并调用 `Logger.log("info", ...)` 记录（见 `package/src/runtime/agent/runtime.ts`）。

---

## 4. 对话（Chat）是如何记录的？

对话落盘由 `ChatStore` 管理（`package/src/runtime/chat/store.ts`）：

- 文件：`.ship/chats/<encode(chatKey)>.jsonl`
- 单行结构（`ChatLogEntryV1`）：`{ v, ts, channel, chatId, chatKey, role, text, meta }`
- 自动归档：当单个 chat 文件行数超过阈值（默认 1000），会把前半部分搬到
  `.ship/chats/<chatKey>.archive-<n>.jsonl`

这部分数据更接近“消息级审计”（谁在何时发了什么），而 `.ship/logs/` 更偏“执行/系统事件”。

---

## 5. Runs / Queue / Approvals 的记录方式

### 5.1 Runs（一次执行的结果快照）

`RunRecord` 会以 JSON 文件保存到：

- `.ship/runs/<runId>.json`

字段包括：`status`、`startedAt/finishedAt`、`input.instructions`、`output.text`、`pendingApproval` 等（见 `package/src/runtime/run/types.ts`、`package/src/runtime/run/store.ts`）。

### 5.2 Queue（执行队列 token）

队列 token 是 JSON 文件：

- `.ship/queue/pending/<runId>.json`
- `.ship/queue/running/<runId>.json`
- `.ship/queue/done/<runId>.json`

用于 RunWorker 的“认领/去重/并发控制”（见 `package/src/runtime/run/queue.ts`、`package/src/runtime/run/worker.ts`）。

### 5.3 Approvals（审批请求/结果）

审批请求会以 JSON 文件保存到：

- `.ship/approvals/<approvalId>.json`

`ApprovalStore` 会在启动时从磁盘 reload 所有 `status=pending` 的请求并缓存（见 `package/src/runtime/permission/approvals-store.ts`）。

工具执行器在需要审批时会先写 approval log（系统 `Logger.approval(...)`），然后等待 `permissionEngine.waitForApproval(...)` 返回（见 `package/src/runtime/tools/executor.ts`）。

---

## 6. 排查建议（快速定位问题）

- **我想看“系统/Agent/模型请求响应”的统一日志**：看 `.ship/logs/<date>.jsonl`（统一 `Logger`）
- **我想回放某次执行是否成功、输出是什么**：看 `.ship/runs/<runId>.json`
- **我想知道为什么卡在审批**：看 `.ship/approvals/*.json` + `.ship/logs/*`
- **我想查某个用户/会话说了什么**：看 `.ship/chats/<chatKey>*.jsonl`
