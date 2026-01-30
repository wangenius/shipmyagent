# Agent 实现逻辑报告

本文档基于当前仓库代码，描述 ShipMyAgent 的 Agent Runtime 从启动、接入 LLM、执行 Tool Loop、权限审批到 Telegram/飞书集成与任务调度的实现逻辑，并给出关键源码入口，便于二次开发与排障。

> 约定：文中所写路径均以仓库根目录为基准。

---

## 1. 总览：核心组件与职责

- **CLI 启动与装配**：读取 `Agent.md` / `ship.json`，创建 Logger、权限引擎、ToolExecutor、AgentRuntime、TaskExecutor、TaskScheduler、HTTP Server、（可选）Interactive Web、（可选）Telegram/飞书 Bot。  
  入口：`package/src/commands/start.ts`
- **AgentRuntime**：对外提供 `initialize()` 与 `run()`，内部实现“手动 Tool Loop”（基于 ai-sdk 的 `generateText` + toolCalls）。  
  入口：`package/src/runtime/agent.ts`
- **PermissionEngine**：控制 read/write/exec 权限、创建/落盘审批请求、轮询等待审批结果。  
  入口：`package/src/runtime/permission.ts`
- **ToolExecutor（Legacy/Server 侧）**：提供 read/write/list/exec 等操作（HTTP/Task 场景），带权限与审批等待。  
  入口：`package/src/runtime/tools.ts`
- **TaskScheduler / TaskExecutor**：从 `.ship/tasks/*.md` 加载任务并 cron 调度，实际执行仍通过 `AgentRuntime.run()`。  
  入口：`package/src/runtime/scheduler.ts`、`package/src/runtime/task-executor.ts`
- **HTTP Server / Interactive Web**：主 API 提供执行指令接口；Interactive Web 作为代理与静态资源服务。  
  入口：`package/src/server/index.ts`、`package/src/server/interactive.ts`
- **Integrations（Telegram/飞书）**：把聊天消息映射为 `AgentRuntime.run()`，并提供审批通知/处理（Telegram）。  
  入口：`package/src/integrations/telegram.ts`、`package/src/integrations/feishu.ts`

---

## 2. 启动流程：从 `shipmyagent start` 到服务运行

启动主入口：`package/src/commands/start.ts`

### 2.1 启动前置校验

- 必须存在 `Agent.md` 与 `ship.json`，否则提示用户先 `shipmyagent init`。  
  见：`package/src/commands/start.ts:23`

### 2.2 读取配置（含 `.env` 与占位符）

- 通过 `loadShipConfig(projectRoot)` 读取 `ship.json`：  
  - 只加载项目根目录下 `.env`（不向上搜索）。见：`package/src/utils.ts:327`  
  - 支持把 `${ENV_VAR}` 形式递归替换为实际环境变量值。见：`package/src/utils.ts:332`、`package/src/utils.ts:356`
- `startCommand` 在装配阶段使用同样的 `loadShipConfig()`。见：`package/src/commands/start.ts:38`

### 2.3 组件装配顺序（关键）

在 `startCommand` 中主要按以下顺序装配：

1. Logger：`createLogger(projectRoot, 'info')`  
   见：`package/src/commands/start.ts:52`、`package/src/runtime/logger.ts:124`
2. PermissionEngine：`createPermissionEngine(projectRoot)`  
   见：`package/src/commands/start.ts:60`、`package/src/runtime/permission.ts:327`
3. ToolExecutor（Legacy/Server 用）：`createToolExecutor({ projectRoot, permissionEngine, logger })`  
   见：`package/src/commands/start.ts:64`、`package/src/runtime/tools.ts:332`
4. AgentRuntime（主进程模式）：`createAgentRuntime({ projectRoot, config: shipConfig, agentMd })` + `await initialize()`  
   见：`package/src/commands/start.ts:74`、`package/src/runtime/agent.ts:989`
5. TaskExecutor：持有 toolExecutor + agentRuntime，执行任务/指令本质是 `agentRuntime.run()`  
   见：`package/src/commands/start.ts:85`、`package/src/runtime/task-executor.ts:17`
6. TaskScheduler：加载 `.ship/tasks/*.md` 并 cron schedule  
   见：`package/src/commands/start.ts:91`、`package/src/runtime/scheduler.ts:33`
7. HTTP Server：`createServer(serverContext)`，提供 `/api/execute` 等  
   见：`package/src/commands/start.ts:110`、`package/src/server/index.ts:69`
8. 可选：Interactive Web（代理）  
   见：`package/src/commands/start.ts:142`、`package/src/server/interactive.ts:38`
9. 可选：Telegram Bot  
   见：`package/src/commands/start.ts:121`、`package/src/integrations/telegram.ts:574`
10. 可选：Feishu Bot（长连接）  
    见：`package/src/commands/start.ts:133`、`package/src/integrations/feishu.ts:286`

---

## 3. AgentRuntime：初始化逻辑（LLM 接入方式）

入口：`package/src/runtime/agent.ts`

### 3.1 API Key 解析与兜底

`AgentRuntime.initialize()` 会按以下优先级确定 API Key：

1. `ship.json -> llm.apiKey`（支持 `${ENV_VAR}` 占位符）  
   见：`package/src/runtime/agent.ts:169`
2. 常见环境变量兜底：`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `API_KEY`  
   见：`package/src/runtime/agent.ts:176`

若最终没有 API Key，则进入 simulation mode（不调用模型）。见：`package/src/runtime/agent.ts:181`

### 3.2 Provider 加载与 Model 实例化

根据 `ship.json -> llm.provider` 动态加载：

- `anthropic`：`@ai-sdk/anthropic`  
  见：`package/src/runtime/agent.ts:190`
- `custom`：`@ai-sdk/openai-compatible`（OpenAI 兼容接口 + 自定义 baseUrl）  
  见：`package/src/runtime/agent.ts:201`
- 其他：`@ai-sdk/openai`（默认认为 OpenAI provider）  
  见：`package/src/runtime/agent.ts:215`

最终以 `providerInstance(model, { temperature })` 生成 `this.agent`；`maxTokens` 可选，未配置时会使用运行时默认值。见：`package/src/runtime/agent.ts:232`

---

## 4. AgentRuntime：核心执行逻辑（手动 Tool Loop）

入口：`package/src/runtime/agent.ts`

### 4.1 run() 的输入与 session 设计

`AgentRuntime.run({ instructions, context })`：

- `sessionId` 生成规则：`context.sessionId` > `context.userId` > `'default'`  
  见：`package/src/runtime/agent.ts:415`
- 系统提示词使用 `this.context.agentMd`（来自 `Agent.md` 或 `Agent.md + DEFAULT_SHELL_GUIDE` 的拼接，取决于创建方式）  
  见：`package/src/runtime/agent.ts:418`、`package/src/runtime/agent.ts:993`

### 4.2 createTools()：只暴露一个工具 `exec_shell`

`createTools()` 返回唯一 tool：`exec_shell`：

- 参数：`{ command: string, timeout?: number }`（Zod 校验）  
  见：`package/src/runtime/agent.ts:367`
- 执行：`execa(command, { cwd: projectRoot, shell: true, reject: false, timeout })`  
  见：`package/src/runtime/agent.ts:376`

> 说明：因为 `shell: true`，命令允许 `&&`/`;`/`|` 等 shell 组合；权限系统对其限制取决于 `permissions.exec_shell` 的策略（见第 5 节）。

### 4.3 runWithGenerateText()：20 轮迭代的工具循环

核心流程（每轮）：

1. 把用户输入加入会话历史（最多保留 20 条）。见：`package/src/runtime/agent.ts:469`、`package/src/runtime/agent.ts:150`
2. 构建 `conversationContext`：把历史消息拼成文本（`User:`/`Assistant:`/`Tool Result:`）。见：`package/src/runtime/agent.ts:777`
3. 调用 `generateText({ model, system, prompt, tools })`。见：`package/src/runtime/agent.ts:485`
4. 若没有 toolCalls：结束并返回最终文本。见：`package/src/runtime/agent.ts:513`
5. 若有 toolCalls：逐条处理：
   - 解析 `toolCallId/toolName/args`（ai-sdk toolCall 可能使用 `input` 字段）。见：`package/src/runtime/agent.ts:540`
   - 归一化 args（避免 `{"": "ls -la"}` 这类异常形态导致缺参）。见：`package/src/runtime/agent.ts:302`、`package/src/runtime/agent.ts:544`
   - 权限检查与审批等待（见第 5 节）。见：`package/src/runtime/agent.ts:556`、`package/src/runtime/agent.ts:607`
   - 执行 tool，并把结果写入 toolCalls 记录与对话历史。见：`package/src/runtime/agent.ts:665`、`package/src/runtime/agent.ts:711`
6. 用更新后的历史重新构建 `conversationContext`，进入下一轮。见：`package/src/runtime/agent.ts:722`

### 4.4 上下文过长的自动恢复

如果捕获到类似 “context too long” 的错误，会清理该 session 的历史并返回提示让用户重发。见：`package/src/runtime/agent.ts:742`

### 4.5 simulation mode（无 API Key）

无 API Key 时，走 `runSimulated()`，按关键词返回 status/tasks/scan/approvals 的静态信息。见：`package/src/runtime/agent.ts:803`

---

## 5. 权限系统与审批（PermissionEngine）

入口：`package/src/runtime/permission.ts`

### 5.1 权限配置结构（ship.json）

核心字段：

- `permissions.read_repo`：是否可读（可选按路径限制）  
- `permissions.write_repo`：写入路径白名单 + 是否需要审批  
- `permissions.exec_shell`：命令黑名单（deny，默认禁用 `rm`）+ 是否需要审批（另保留 legacy 的 allow）

数据结构见：`package/src/runtime/permission.ts:27`

### 5.2 审批请求的存储与加载

- 审批请求落盘位置：`.ship/approvals/*.json`  
  路径计算：`getApprovalsDirPath(projectRoot)`。见：`package/src/utils.ts:419`
- PermissionEngine 构造时会把磁盘上的 pending 审批加载进内存。见：`package/src/runtime/permission.ts:46`、`package/src/runtime/permission.ts:56`

### 5.3 exec_shell 权限检查

`checkExecShell(command)`：

- 若 `exec_shell.deny` 非空：按“每段命令的命令名”做黑名单拦截（支持 `&&`/`|`/`;` 等分隔）。  
  例如：`rm -rf a && ls -la` 会命中 `rm` 而被拒绝。
- 否则若 `exec_shell.allow` 非空（legacy）：只允许 allow 里的命令名。  
  例如：`ls -la` 的命令名是 `ls`。
- 若 `exec_shell.requiresApproval=true`：创建审批请求并返回 `approvalId`，调用方进入等待。见：`package/src/runtime/permission.ts:171`
- 否则直接允许。见：`package/src/runtime/permission.ts:184`

> 注意：当前 allow-list 只检查“第一个 token”，而实际执行支持 `shell` 组合命令，因此如果需要强安全隔离，建议对 `command` 做更严格解析或强制审批策略（例如：对含 `&&`/`|`/`;` 的命令一律审批）。

### 5.4 AgentRuntime 中的审批等待与拒绝提示

AgentRuntime 在 tool loop 中处理审批：

- `requiresApproval`：调用 `waitForApproval(approvalId, 300s)` 等待，超时/拒绝会中断执行。见：`package/src/runtime/agent.ts:580`
- `denied`：直接把 “No permission…” 作为工具错误写回给模型，并附带如何配置 allow 的 hint。见：`package/src/runtime/agent.ts:279`

---

## 6. Integrations：Telegram / 飞书是如何驱动 Agent 的

### 6.1 Telegram

入口：`package/src/integrations/telegram.ts`

- **会话隔离**：每个用户一个 AgentRuntime（key：`telegram:${userId}`），30 分钟无操作自动清理。见：`package/src/integrations/telegram.ts:89`、`package/src/integrations/telegram.ts:77`
- **消息处理**：非 `/` 命令消息会调用 `agentRuntime.run({ context: { source:"telegram", sessionId } })`，并把输出回发。见：`package/src/integrations/telegram.ts:287`、`package/src/integrations/telegram.ts:451`
- **审批通知**（需要配置 `chatId`）：定时读取 pending approvals，并用 inline keyboard 推送 “Approve/Reject”。见：`package/src/integrations/telegram.ts:169`、`package/src/integrations/telegram.ts:224`
- **审批处理**：支持 `/approve <id>`、`/reject <id>` 与按钮回调。见：`package/src/integrations/telegram.ts:368`、`package/src/integrations/telegram.ts:409`

### 6.2 飞书（Feishu）

入口：`package/src/integrations/feishu.ts`

- **长连接接收消息**：使用 `@larksuiteoapi/node-sdk` 的 WSClient 接入事件。见：`package/src/integrations/feishu.ts:99`
- **会话隔离**：按 `${chatType}:${chatId}` 作为 session key，30 分钟回收。见：`package/src/integrations/feishu.ts:52`
- **执行**：普通文本消息会 `agentRuntime.run({ context: { source:'feishu', sessionId } })` 并回发结果。见：`package/src/integrations/feishu.ts:208`
- **注意**：飞书实现目前没有集成审批通知/按钮，主要是“对话执行”通道。见：`package/src/integrations/feishu.ts:160`

---

## 7. 任务系统：`.ship/tasks/*.md` → cron → Agent 执行

入口：`package/src/runtime/scheduler.ts`、`package/src/runtime/task-executor.ts`

### 7.1 任务文件格式

- 任务文件位置：`.ship/tasks/*.md`  
- Frontmatter（YAML）字段：`id/name/cron/notify/enabled` 等，正文会作为 instructions。  
  解析实现：`parseTaskFile()`。见：`package/src/runtime/scheduler.ts:57`

### 7.2 调度与执行

- `TaskScheduler.start()` 使用 `node-cron` 注册计划任务。见：`package/src/runtime/scheduler.ts:110`
- 触发后调用 `taskHandler(task)`，在 `startCommand` 中该 handler 会调用 `taskExecutor.executeTask(...)`。见：`package/src/commands/start.ts:96`
- `TaskExecutor.executeTask()` 最终仍调用 `agentRuntime.run()`（读任务 md 后把正文作为 instructions）。见：`package/src/runtime/task-executor.ts:26`

---

## 8. HTTP 服务：指令执行 API 与交互式 Web

### 8.1 主 API Server

入口：`package/src/server/index.ts`

- `POST /api/execute`：读取 JSON body 的 `instructions`，调用 `taskExecutor.executeInstructions(instructions)`。见：`package/src/server/index.ts:100`

### 8.2 Interactive Web（代理）

入口：`package/src/server/interactive.ts`

- 静态资源：`index.html/styles.css/app.js` 从 `package/public` 提供。见：`package/src/server/interactive.ts:52`
- `/api/*`：代理到主 API Server。见：`package/src/server/interactive.ts:97`

---

## 9. 运行时数据目录：`.ship/`

相关路径工具方法：`package/src/utils.ts`

默认结构：

```
.ship/
  approvals/   # 审批请求（json）
  logs/        # 日志
  tasks/       # 任务（md）
  routes/      # 预留/扩展（当前未见核心逻辑使用）
  .cache/      # 预留/扩展
```

- 初始化创建：`package/src/commands/init.ts:122`
- 运行时兜底创建：`package/src/runtime/agent.ts:1025`

日志实现存在两套：

- `Logger`（通用）：错误/警告会写 `.ship/logs/YYYY-MM-DD.log`。见：`package/src/runtime/logger.ts:73`  
- `AgentLogger`（AgentRuntime 内部）：写 `.ship/logs/YYYY-MM-DD.json`。见：`package/src/runtime/agent.ts:956`

---

## 10. 时序图（典型路径）

### 10.1 Telegram 消息 → Agent 执行（含工具与审批）

```
Telegram Update
  -> TelegramBot.handleMessage()
    -> AgentRuntime.run()
      -> runWithGenerateText() [if initialized]
        -> generateText()
          -> toolCalls: exec_shell
            -> PermissionEngine.checkExecShell()
              -> (optional) create approval + waitForApproval()
            -> exec_shell.execute() (execa shell)
        -> generateText() ... (next iteration)
      -> return output
  -> TelegramBot.sendMessage()
```

### 10.2 HTTP API 执行指令

```
POST /api/execute
  -> TaskExecutor.executeInstructions()
    -> AgentRuntime.run()
      -> (LLM tool loop OR simulation)
  -> JSON response
```

---

## 11. 已知差异/潜在问题（便于后续改进）

1. **system prompt 拼接方式不统一**：  
   - `startCommand` 直接读取 `Agent.md` 作为 `agentMd`。见：`package/src/commands/start.ts:74`  
   - `createAgentRuntimeFromPath()` 会把 `Agent.md + DEFAULT_SHELL_GUIDE` 拼接。见：`package/src/runtime/agent.ts:1055`  
   这会导致“同项目不同启动通道”下，模型收到的 system prompt 不一致。

2. **exec_shell 的安全边界**：  
   当前黑名单是“按分隔符拆分后取每段命令名”的 best-effort 检查，仍可能被 `bash -c` 等方式绕过；高安全场景建议配合 `requiresApproval=true` 或更严格的命令解析/执行策略。

3. **审批结构存在两套类型**：  
   `AgentRuntime.executeApproved()` 读取的 `ApprovalRequest` 结构与 `PermissionEngine` 写入的审批 JSON 结构不同，当前更像“遗留/未接入主流程”的能力。见：`package/src/runtime/agent.ts:898`、`package/src/runtime/permission.ts:15`

---

## 12. 快速排障索引

- Telegram 侧“工具缺参 / missing command”：看 `normalizeToolArgs()` 是否生效。`package/src/runtime/agent.ts:298`
- “Command denied by blacklist”：检查 `ship.json -> permissions.exec_shell.deny`（默认包含 `rm`）。
- “Command not in allow list”（legacy）：检查 `ship.json -> permissions.exec_shell.allow`，并确认命令名已放行。
- “Approval timeout”：看 `.ship/approvals` 中是否出现 pending 审批，以及 Telegram 是否配置了 `chatId` 并能推送审批。`package/src/runtime/permission.ts:295`、`package/src/integrations/telegram.ts:224`
