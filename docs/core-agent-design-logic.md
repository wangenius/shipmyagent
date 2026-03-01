# Package 全量架构说明（目录结构 / Agent / 记忆 / 插件系统）

本文档是 `package/` 当前实现的全景说明，覆盖：

1. 源码目录结构与分层职责
2. 运行时目录结构（`.ship/`）
3. Agent 执行内核设计
4. 记忆系统（Memory）
5. 插件系统（模块注册、Skills、MCP、Prompt Provider、平台适配器）
6. 任务系统、配置系统、日志与排障

如果你只关心 Agent 核心执行流程，可以优先读：

1. `package/src/core/runtime/agent-runner.ts`
2. `package/src/core/context/manager.ts`
3. `package/src/core/context/scheduler.ts`
4. `package/src/core/context/history-store.ts`

---

## 1. 设计总览

当前架构的核心原则：

1. **会话隔离**：以 `contextId` 为最小隔离单元（调度、历史、记忆都按 context 维度）。
2. **单一事实源**：`messages.jsonl`（UIMessage）是对话历史唯一来源。
3. **分层清晰**：`core` 做运行内核，`services` 做业务能力，`server` 做编排与注入。
4. **可扩展**：通过模块注册、Prompt Provider、MCP、Skills 等机制扩展能力。
5. **可审计**：关键状态与产物落盘到 `.ship/`，支持回放与排障。

---

## 2. 源码目录结构（package/src）

## 2.1 顶层目录

```text
package/src
├─ cli.ts
├─ commands/
├─ core/
├─ infra/
├─ services/
├─ schemas/
├─ server/
├─ telemetry/
├─ types/
└─ utils.ts
```

## 2.2 各目录职责

1. `cli.ts`
   - CLI 入口，注册 `init/run/start/stop/restart/alias` 和模块命令。
   - 默认把未知根命令转发到 `run`。
2. `commands/`
   - 命令实现层，处理前后台启动、初始化、daemon 管理入口。
3. `core/`
   - 核心运行内核：Agent、Context、History、Prompt、Tools、LLM 工厂。
4. `infra/`
   - 依赖注入端口（ports/types/bridges），让 `services` 仅依赖抽象。
5. `services/`
   - 业务能力模块：chat / skills / task / memory / mcp。
6. `schemas/`
   - `ship.json` 和 `mcp.json` 的 JSON Schema。
7. `server/`
   - HTTP 服务、运行时上下文初始化、系统 provider 注册、daemon 支持。
8. `telemetry/`
   - 日志与 LLM 请求链路上下文（AsyncLocalStorage）。
9. `utils.ts`
   - 配置加载、路径约定、ID 与通用工具函数。

## 2.3 核心目录展开（重点子树）

```text
package/src/core
├─ service/
│  ├─ registry.ts
│  ├─ cli-registry.ts
│  ├─ server-registry.ts
│  ├─ cron-trigger.ts
│  └─ types/service-registry.ts
├─ llm/
│  └─ create-model.ts
├─ prompts/
│  ├─ system.ts
│  ├─ system-provider.ts
│  └─ index.ts
├─ runtime/
│  ├─ agent.ts
│  ├─ agent-runner.ts
│  └─ ui-message.ts
├─ context/
│  ├─ manager.ts
│  ├─ scheduler.ts
│  ├─ history-store.ts
│  └─ request-context.ts
├─ tools/
│  ├─ agent-tools.ts
│  ├─ exec-shell.ts
│  └─ mcp.ts
└─ types/
   ├─ agent.ts
   ├─ context-agent.ts
   ├─ context-history.ts
   ├─ context-messages-meta.ts
   └─ system-prompt-provider.ts
```

```text
package/src/services
├─ chat/
│  ├─ service.ts
│  ├─ service.ts
│  ├─ adapters/
│  ├─ runtime/
│  └─ types/
├─ skills/
│  ├─ service.ts
│  ├─ service.ts
│  ├─ command.ts
│  ├─ runtime/
│  ├─ types/
│  └─ built-in/
├─ task/
│  ├─ service.ts
│  ├─ service.ts
│  ├─ scheduler.ts
│  ├─ runtime/
│  └─ types/
├─ memory/
│  ├─ runtime/
│  └─ types/
└─ mcp/
   └─ runtime/
```

---

## 3. 运行时目录结构（.ship）

以下结构由 `init` 和运行时初始化共同维护：

```text
.ship/
├─ config/
│  └─ mcp.json
├─ schema/
│  ├─ ship.schema.json
│  └─ mcp.schema.json
├─ logs/
│  └─ YYYY-MM-DD.jsonl
├─ .cache/
│  ├─ egress/
│  └─ <adapter-cache>
├─ .debug/
│  ├─ shipmyagent.pid
│  ├─ shipmyagent.daemon.log
│  └─ shipmyagent.daemon.json
├─ public/
├─ profile/
│  ├─ Primary.md
│  └─ other.md
├─ context/
│  └─ <encodedContextId>/
│     ├─ messages/
│     │  ├─ messages.jsonl
│     │  ├─ meta.json
│     │  └─ archive/*.json
│     └─ memory/
│        ├─ Primary.md
│        ├─ .meta.json
│        └─ backup/Primary-<timestamp>.md
├─ task/
│  └─ <taskId>/
│     ├─ task.md
│     └─ <timestamp>/
│        ├─ messages.jsonl
│        ├─ input.md
│        ├─ output.md
│        ├─ result.md
│        ├─ error.md
│        └─ run.json
└─ data/
```

关键说明：

1. 历史唯一事实源是 `messages/messages.jsonl`。
2. `messages/meta.json` 还承载 `pinnedSkillIds`。
3. Task run 目录是完整审计单元，执行过程和结果都写入。

---

## 4. 启动与运行时装配

主流程见 `run` 命令：

1. `initShipRuntimeContext(cwd)` 初始化运行时上下文。
2. 读取 `Agent.md` + `DEFAULT_SHIP_PROMPTS` 形成 `systems`。
3. 初始化 `McpManager`。
4. 初始化 `ContextManager`（并注入 memory maintenance 回调）。
5. 注册 service 的 system prompt providers（skills + memory）。
6. 启动 HTTP Server、可选平台适配器、可选任务 cron。

关键文件：

1. `package/src/commands/run.ts`
2. `package/src/server/ShipRuntimeContext.ts`
3. `package/src/server/index.ts`
4. `package/src/server/system-prompt-providers.ts`

---

## 5. Agent 主体设计

## 5.1 契约与实现

1. 契约：`ContextAgent`（`initialize/run/isInitialized`）
2. 工厂：`createContextAgent()`（隐藏 class 细节）
3. 实现：`ContextAgentRunner`

关键文件：

1. `package/src/core/types/context-agent.ts`
2. `package/src/core/runtime/agent.ts`
3. `package/src/core/runtime/agent-runner.ts`

## 5.2 ContextAgentRunner 分阶段流程

一次 `run()` 的核心阶段：

1. 参数与日志初始化（requestId、contextId）。
2. 单实例单会话绑定（防串线）。
3. 构建 system messages：
   - 运行时上下文 prompt
   - 启动时静态 prompts（Agent.md + DEFAULT）
   - providers 输出（skills/memory 等）
4. 从 history 生成 model messages（必要时先 compact）。
5. `streamText` 执行 tool-loop，支持最多 30 steps。
6. 消费 `UIMessageStream` 产出最终 `assistantMessage`。
7. 返回标准 `AgentResult`。
8. 识别 context window 错误时递进重试（最多 3 次）。

## 5.3 lane merge / step 边界合并

当执行过程中收到新消息：

1. ChatQueueWorker 通过 shared queue 提供 `drainLaneMerged` 回调。
2. Agent 在每个 step 前调用该回调。
3. 有新消息则追加到 history 前缀，下一步立即生效。

这样可减少“模型基于旧输入继续跑很久”的问题。

## 6. Context 与调度系统

## 6.1 ContextManager（生命周期编排）

职责：

1. 缓存 `contextId -> Agent`
2. 缓存 `contextId -> HistoryStore`
3. 入站消息写入 history
4. 历史更新后触发 memory maintenance（异步）

关键点：

1. 一个 `contextId` 对应一个 Agent 实例（上下文连续性）。
2. task-run contextId 会重定向 history 路径到 task run 目录。

文件：`package/src/core/context/ContextManager.ts`

## 6.2 ChatQueueWorker（main 调度）

并发模型：

1. lane 粒度：`chatKey`
2. lane 内：严格串行
3. lane 间：受 `maxConcurrency` 限制并发
4. 调度策略：runnable FIFO + 去重

入站处理（中文）：

1. services/chat 仅入队（不直接写 history）
2. main 在消费队列时写入 context history
3. step 边界合并通过 chat 队列完成

文件：

1. `package/src/main/service/ChatQueueWorker.ts`
2. `package/src/services/chat/runtime/ChatQueue.ts`

## 6.3 配置注意点（重要）

当前实现里，队列配置已经统一为：

1. `services.chat.queue`

包含字段：

1. `maxConcurrency`

---

## 7. 历史系统（History）

## 7.1 数据模型

1. 历史条目是 `UIMessage<ShipContextMetadataV1>`
2. 默认仅存 `role=user|assistant`
3. 历史落盘：`messages.jsonl` 每行一条 JSON

文件：

1. `package/src/core/types/context-history.ts`
2. `package/src/core/context/history-store.ts`

## 7.2 并发安全

`append` 与 `compact` 共用写锁：

1. `open(lock, "wx")` 原子抢锁
2. 锁 token 校验后释放
3. stale lock 自动清理

保证不会因 `append` 与 `rewrite` 并发导致丢数据。

## 7.3 compact 机制

触发条件：

1. 历史长度超过 keepLast 基线
2. system + history 的近似 token 超预算

算法：

1. phase 1：锁内 snapshot
2. phase 1.5：锁外用 LLM 生成“更早历史摘要”
3. phase 2：锁内按“当前最新 history”重算并 rewrite
4. 可选写 archive，meta 写入 compact 参数与 lastArchiveId

---

## 8. 记忆系统（Memory）

记忆系统属于 `services/memory`，不是 core 内核。

## 8.1 触发与流程

触发点：

1. `ContextManager` 在历史更新后调用 `runContextMemoryMaintenance()`

维护流程：

1. 读取 memory 配置（默认启用）
2. 计算“未记忆化条数”是否达到阈值（默认 40）
3. 异步抽取该区间历史为 MemoryEntry
4. append 到 `memory/Primary.md`
5. 更新 `memory/.meta.json`（lastMemorizedEntryCount 等）
6. 若超 `maxPrimaryChars` 则触发压缩（可选先备份）

文件：

1. `package/src/services/memory/runtime/service.ts`
2. `package/src/services/memory/runtime/extractor.ts`
3. `package/src/services/memory/runtime/manager.ts`
4. `package/src/services/memory/types/memory.ts`

## 8.2 注入模型上下文

memory 不直接改 Agent 代码，而是通过 system prompt provider 注入：

1. 读取 `.ship/profile/Primary.md`
2. 读取 `.ship/profile/other.md`
3. 读取 `.ship/context/<id>/memory/Primary.md`
4. 转为 `system` messages 追加到 provider 输出

文件：`package/src/services/memory/runtime/system-provider.ts`

---

## 9. 插件系统总览

当前“插件”是多层机制，不止一种：

1. **模块插件**：`SmaModule`（chat/skills/task）
2. **Prompt 插件**：System Prompt Provider（skills/memory）
3. **能力插件**：MCP servers/tools
4. **技能插件**：Skills（`SKILL.md`）
5. **平台插件**：Chat adapters（telegram/feishu/qq）

## 9.1 模块插件（SmaModule）

统一注册入口：

1. `MODULES = [chatModule, skillsModule, taskModule]`
2. CLI 通过 `registerAllModulesForCli()` 注入命令
3. Server 通过 `registerAllServicesForServer()` 注入路由

文件：

1. `package/src/core/service/registry.ts`
2. `package/src/core/service/types/service-registry.ts`
3. `package/src/core/service/cli-registry.ts`
4. `package/src/core/service/server-registry.ts`
5. `package/src/services/*/service.ts`

## 9.2 Prompt 插件（System Prompt Provider）

注册中心策略：

1. 按 `order` 排序执行
2. `messages` 追加聚合
3. `activeTools` 通过交集收敛
4. provider 失败 fail-open（不中断主流程）

Server 启动时注册：

1. `skills` provider（order 200）
2. `memory` provider（order 300）

文件：

1. `package/src/core/prompts/system-provider.ts`
2. `package/src/server/system-prompt-providers.ts`

## 9.3 Skills 插件系统

### 9.3.1 技能发现

扫描根：

1. project：`.ship/skills`
2. config paths：`ship.json.skills.paths`
3. home：`~/.ship/skills`

冲突策略：

1. 同 id 技能先到先得（按 roots 优先级）

文件：`package/src/services/skills/runtime/discovery.ts`

### 9.3.2 技能加载与 pin

用户加载/卸载 skill 时：

1. 将 skill id 写入 context 的 `messages/meta.json.pinnedSkillIds`
2. provider 在运行时读取 pinnedSkillIds 并装载对应 `SKILL.md`
3. 无效 pin（文件缺失/不可读）自动清理

文件：

1. `package/src/services/skills/service.ts`
2. `package/src/services/skills/runtime/system-provider.ts`

### 9.3.3 工具白名单收敛

已加载 skill 若定义 `allowedTools`：

1. 构造强约束 system 文本
2. 计算 `activeTools = exec_command/write_stdin/close_context + allowedTools`
3. 与当前真实可用工具求交集
4. 交给 Agent step 覆盖，限制可调用工具

文件：`package/src/services/skills/runtime/active-skills-prompt.ts`

## 9.4 MCP 能力插件系统

MCP 生命周期：

1. 读取 `.ship/config/mcp.json`
2. 按 server 配置连接（stdio / sse / http）
3. `listTools()` 发现工具
4. 映射为 AI SDK 工具（命名 `server:tool`）
5. Agent tool-loop 中按需调用 `mcpManager.callTool()`

失败策略：

1. 单服务连接失败记录 error 状态，不阻塞其他服务

关键文件：

1. `package/src/services/mcp/runtime/manager.ts`
2. `package/src/services/mcp/runtime/types.ts`
3. `package/src/services/mcp/runtime/http-transport.ts`
4. `package/src/core/tools/mcp.ts`
5. `package/src/schemas/mcp.schema.ts`

## 9.5 平台适配器插件系统（Chat Adapters）

平台适配器通过 `PlatformAdapter` 抽象统一接入：

1. 各平台实现 `getChatKey` 与 `sendTextToPlatform`
2. 构造时自动注册 `channel -> dispatcher`
3. `chat_send` 或任务回包可通过 dispatcher 路由到具体平台

文件：

1. `package/src/services/chat/adapters/platform-adapter.ts`
2. `package/src/services/chat/runtime/chat-send-registry.ts`
3. `package/src/services/chat/runtime/chatkey-send.ts`

---

## 10. 工具系统（Tools）

工具集合由 `createAgentTools()` 组装：

1. Bash-first 会话工具（`exec_command` / `write_stdin` / `close_context`）
2. MCP 映射工具（`server:tool`）

Shell 会话工具特性：

1. 会话化子进程管理
2. 输出分片与预算控制（chars/lines/tokens）
3. 上下文环境变量注入（`SMA_CTX_*`）
4. 会话数量上限与清理机制

关键文件：

1. `package/src/core/tools/agent-tools.ts`
2. `package/src/core/tools/exec-shell.ts`

---

## 11. Task 系统

Task 是独立的业务子系统（非 core 内核）：

1. 定义文件：`.ship/task/<taskId>/task.md`
2. 执行目录：`.ship/task/<taskId>/<timestamp>/`
3. run 时使用专用 `task-run:<taskId>:<timestamp>` contextId
4. Agent 执行完成后写入 `result.md/run.json` 并通知 `chatKey`
5. cron 引擎支持定时触发，且同 taskId 串行防重入

关键文件：

1. `package/src/services/task/service.ts`
2. `package/src/services/task/runtime/runner.ts`
3. `package/src/services/task/runtime/store.ts`
4. `package/src/services/task/runtime/paths.ts`
5. `package/src/services/task/scheduler.ts`
6. `package/src/core/service/cron-trigger.ts`

---

## 12. 配置系统（ship.json / mcp.json / env）

## 12.1 ship.json

重点字段：

1. `start.*`：服务启动参数
2. `llm.*`：模型配置（支持 `${ENV}` 占位符）
3. `skills.*`：技能扫描根与外部路径策略
4. `context.messages.*`：history compact 策略
5. `services.chat.queue.*`：chat 调度参数
6. `context.memory.*`：记忆提取/压缩策略
7. `permissions.*`：执行权限与输出预算
8. `adapters.*`：平台接入配置

文件：

1. `package/src/utils.ts`（`ShipConfig` + 加载逻辑）
2. `package/src/schemas/ship.schema.ts`

## 12.2 mcp.json

结构：

1. `servers.<name>.type = stdio|sse|http`
2. 各 transport 对应 command/url/headers/env

文件：

1. `package/src/schemas/mcp.schema.ts`
2. `package/src/services/mcp/runtime/manager.ts`

## 12.3 env 解析

1. `loadProjectDotenv(projectRoot)` 仅加载项目根 `.env`
2. `ship.json` 中 `${VAR}` 会在加载时解析为环境变量

文件：`package/src/utils.ts`

---

## 13. 日志与可观测性

日志系统：

1. 统一 logger（控制台 + JSONL）
2. 按天写入 `.ship/logs/YYYY-MM-DD.jsonl`
3. LLM 请求上下文通过 AsyncLocalStorage 传递 `contextId/requestId`

文件：

1. `package/src/telemetry/logger.ts`
2. `package/src/telemetry/context.ts`
3. `package/src/telemetry/fetch.ts`

---

## 14. daemon 与进程模型

`start/stop/restart` 依赖 daemon 管理器：

1. 后台进程由 `node cli.js run ...` detached 启动
2. PID/日志/元数据写入 `.ship/.debug/`
3. stop 先 `SIGTERM`，超时后 `SIGKILL`

关键文件：

1. `package/src/commands/start.ts`
2. `package/src/commands/stop.ts`
3. `package/src/commands/restart.ts`
4. `package/src/server/daemon/manager.ts`

---

## 15. 扩展开发指南（按类型）

## 15.1 新增业务模块（类似 chat/skills/task）

1. 实现 `SmaModule`（CLI + Server 注册）
2. 放到 `services/<service>/service.ts`
3. 在 `core/service/registry.ts` 的 `MODULES` 中注册

## 15.2 新增 Prompt Provider

1. 实现 `SystemPromptProvider`
2. 在 server 启动时注册
3. 明确 `order`，并保证失败 fail-open

## 15.3 新增技能体系能力

1. 扩展 skills discovery / provider / pinned 逻辑
2. 尽量保持 skill 状态只落在 history meta，不新建平行状态源

## 15.4 新增 MCP 能力

1. 在 `.ship/config/mcp.json` 注册 server
2. Manager 自动发现并映射工具
3. 若需特殊协议，可扩展 transport 层

## 15.5 新增平台适配器

1. 继承 `PlatformAdapter` 或 `BaseChatAdapter`
2. 实现 chatKey 规则与发送 API
3. 在 `runCommand` 中按 config 启动并注册 dispatcher

---

## 16. 常见问题排查

1. **历史看起来不一致**
   - 检查是否绕过 `ContextHistoryStore.append()`
   - 检查 compact 是否在高频触发
2. **会话串线**
   - 检查 `contextId` 生成规则
   - 检查是否错误复用 Agent 实例
3. **技能加载后不生效**
   - 检查 `pinnedSkillIds` 是否写入对应 context meta
   - 检查 `SKILL.md` 是否可读
4. **MCP 工具不可见**
   - 检查 `.ship/config/mcp.json` 与连接状态
   - 检查 server 是否成功 `listTools()`
5. **任务重复执行或跳过**
   - 检查 cron 表达式与 status
   - 检查 task 串行保护日志（runningByTaskId）
6. **聊天平台无回包**
   - 检查 channel dispatcher 是否注册
   - 检查 `chatKey -> chatId` 解析与历史回填元数据

---

## 17. 关键文件索引（按子系统）

Agent 内核：

1. `package/src/core/runtime/agent-runner.ts`
2. `package/src/core/runtime/agent.ts`
3. `package/src/core/types/agent.ts`
4. `package/src/core/types/context-agent.ts`

Context/History：

1. `package/src/core/context/manager.ts`
2. `package/src/core/context/scheduler.ts`
3. `package/src/core/context/history-store.ts`
4. `package/src/core/types/context-history.ts`

Prompt/Tools：

1. `package/src/core/prompts/system.ts`
2. `package/src/core/prompts/system-provider.ts`
3. `package/src/core/tools/agent-tools.ts`
4. `package/src/core/tools/exec-shell.ts`
5. `package/src/core/tools/mcp.ts`

Services：

1. `package/src/services/chat/*`
2. `package/src/services/skills/*`
3. `package/src/services/task/*`
4. `package/src/services/memory/*`
5. `package/src/services/mcp/runtime/*`

Server/Infra：

1. `package/src/server/ShipRuntimeContext.ts`
2. `package/src/server/index.ts`
3. `package/src/server/system-prompt-providers.ts`
4. `package/src/infra/service-runtime-ports.ts`
5. `package/src/infra/service-runtime-types.ts`

配置/初始化：

1. `package/src/commands/init.ts`
2. `package/src/utils.ts`
3. `package/src/schemas/ship.schema.ts`
4. `package/src/schemas/mcp.schema.ts`

---

## 18. 一句话总结

当前 Package 的实现是一个“**Context 驱动、History 为中心、Provider 可扩展、模块化集成**”的 Agent Runtime：`core` 保持稳定内核，`services` 承载业务能力，`server` 做统一编排和注入，所有关键状态都可在 `.ship/` 下追踪与审计。
