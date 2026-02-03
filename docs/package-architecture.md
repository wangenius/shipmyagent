# ShipMyAgent（package）架构说明：Agent Runtime × Adapters（平台适配）

本文档用于**完整描述当前 `package/`（npm 包：`shipmyagent`）的架构逻辑**，重点解释：

- Agent（`AgentRuntime`）如何运行、如何调用工具、如何处理审批
- 平台适配器（Telegram / 飞书 / QQ 等）与 Agent 的边界与协作方式
- 核心数据/状态落盘在 `.ship/` 的哪些位置，以及它们在运行链路中的作用

> 文档面向代码读者，内容会引用关键目录/文件以便快速定位实现。

---

## 1. 仓库分层（Repo Layout）

该仓库大致分三块：

- `package/`：真正发布的 npm 包（CLI + Server + Runtime + Integrations）
- `homepage/`：官网文档站（MDX），面向用户
- `docs/`：工程内设计/实现文档（偏工程决策、实现细节）

本文聚焦 `package/`。

---

## 2. package 的“主入口”与启动拓扑

### 2.1 CLI 入口：`shipmyagent`

- 入口：`package/src/cli.ts`
- 主要命令：
  - `shipmyagent init [path]`：初始化项目（生成 `Agent.md`、`ship.json`、`.ship/` 目录结构）
  - `shipmyagent start [path]`：启动服务端 + Runtime +（可选）平台集成
  - `shipmyagent alias`：写入 shell alias

默认行为：`shipmyagent` / `shipmyagent .` 会被当作 `shipmyagent start .` 执行（见 `cli.ts` 的默认命令逻辑）。

### 2.2 初始化：生成三类“事实来源”

`shipmyagent init`（`package/src/commands/init.ts`）会创建：

- **Agent 定义**：`Agent.md`（agent 的人格/规则/偏好/写作规范的主要入口）
- **运行配置**：`ship.json`（模型、权限、adapters 等）
- **运行状态目录**：`.ship/`（tasks/runs/queue/approvals/chats/logs/cache/mcp/public 等）

`.ship/` 的路径由 `package/src/utils.ts` 提供（例如 `getApprovalsDirPath()`、`getChatsDirPath()`）。

### 2.3 启动：把“Runtime + Server + Adapters”组装起来

`shipmyagent start`（`package/src/commands/start.ts`）做的事情可以理解为一次“依赖注入”：

1. 读取 `Agent.md` 与 `ship.json`
2. 初始化核心服务：
   - `PermissionEngine`（权限与审批落盘）
   - `ToolExecutor`（工具执行器）
   - `AgentRuntime`（核心 agent：LLM + tools + approvals + memory）
   - `TaskExecutor`（把任务/指令交给 `AgentRuntime` 执行）
   - `RunWorker` / `RunManager`（任务运行队列，Tasks v2）
   - `TaskScheduler`（cron 调度 → enqueue run）
3. 启动 HTTP Server（`package/src/server/index.ts`）
4. 按 `ship.json.adapters.*.enabled` 启动平台适配器（`package/src/integrations/*`）

一句话：**start 负责把“人类入口（HTTP/平台消息）”接到“AgentRuntime 的一次 run”上，并提供任务调度与审批闭环。**

---

## 3. Agent Runtime：核心能力与内部组成

### 3.1 AgentRuntime 是什么

核心实现：`package/src/runtime/agent/runtime.ts`

`AgentRuntime` 是“每个项目目录一个”的运行时容器，负责：

- 读取并拼接系统提示词（`Agent.md` + 内置 prompts +（可选）skills section）
- 初始化 LLM 与 ToolLoopAgent（基于 Vercel AI SDK：`ToolLoopAgent` / `tool()`）
- 将工具调用纳入权限/审批体系（`PermissionEngine`）
- 维护对话历史（以 `chatKey` 为 key）
- 管理上下文压缩（`ContextCompressor`）
- 管理长期记忆抽取与召回（`MemoryExtractor` / `MemoryStoreManager`）
- 消费由 server/bootstrap 初始化过的 MCP manager，并把 MCP tools 暴露给 agent（`McpManager`）

### 3.2 AgentRuntime 的输入输出

核心调用形态：

```ts
agentRuntime.run({
  instructions: string,
  context?: {
    source?: "telegram" | "feishu" | "qq" | "cli" | "api" | ...
    chatKey?: string
    userId?: string
    messageId?: string
    chatType?: string
    messageThreadId?: number
    actorId?: string
    actorUsername?: string
    // ...任务触发还会带 taskId 等
  },
  onStep?: (step) => void
})
```

输出为 `AgentResult`（文本、工具调用记录、是否 pending approval 等）。

关键点：`chatKey` 决定对话隔离与审批关联（如果未提供会退化为 `"default"`）。

### 3.3 工具系统：工具“是什么”、从哪里来、如何调用

工具集合由 `createAgentToolSet()` 生成（`package/src/tool/toolset.ts`），主要包含：

- `chat_send`（把消息“发回平台”，用于平台 adapters；见 `package/src/tool/chat.ts`）
- `exec_shell`（执行命令，受权限与审批控制）
- `skills_*`（skills 相关工具）
- `runs_*`（运行/队列相关工具）
- `cloud_file_*` / `s3_upload`（与 `.ship/public/` + OSS 上传相关）
- `server:tool`（MCP tools：来自 `.ship/mcp/mcp.json` 的 MCP server 列表；见 `docs/mcp.md` 与 `package/src/runtime/mcp/*`）

工具的共同特征：

- 以 AI SDK `tool({ inputSchema, execute, ... })` 形式暴露给模型
- 在 `execute()` 内部会读取运行上下文（项目根目录、权限引擎、当前 chat context 等）

### 3.4 权限与审批：为什么需要、状态如何落盘、如何恢复

权限系统核心：`package/src/runtime/permission/*`

原则：**凡是有副作用的行为（写文件、执行 shell、调用 MCP 工具等）都可以进入审批流程。**

当前审批的事实来源是磁盘文件：`.ship/approvals/*.json`（创建/更新/删除）。

典型链路（简化）：

```
LLM -> 想调用 needsApproval 的工具
  -> ToolLoopAgent 返回 tool-approval-request（AI SDK approvalId）
  -> AgentRuntime 转成 ShipMyAgent approval：
       - PermissionEngine 写入 .ship/approvals/<approvalId>.json
       - 记录 meta.aiApprovalId（把 AI SDK approvalId 映射回来）
  -> 上层（例如平台适配器）提示用户“是否批准？”
用户回复（同意/拒绝/范围授权）
  -> AgentRuntime.handleApprovalReply(...)
  -> 读取 pending approvals + 解析用户意图
  -> 构造 tool-approval-response（AI SDK 格式）写回对话历史
  -> 继续 ToolLoopAgent 运行
```

这也是为什么**同一 `chatKey` 必须串行执行**：否则 approval-response 很容易回到错误的上下文。

> 更完整的执行模型分析可参考：`docs/execution-model-and-platform-adapters.md`

---

## 4. Adapters：平台适配器与 Agent 的关系

### 4.1 “Adapter”的定义

在 `ship.json.adapters` 中，**adapters 指“消息平台入口/出口”**，例如：

- Telegram：`package/src/integrations/telegram.ts`
- 飞书：`package/src/integrations/feishu.ts`
- QQ：`package/src/integrations/qq.ts`

它们的职责不是“实现 agent”，而是：

1. 把平台的入站事件（消息/回调按钮/引用回复）解析成统一的 `IncomingChatMessage`
2. 为该消息选择一个稳定的 `chatKey`
3. 把消息交给 `AgentRuntime.run()`（并带上 `context`）
4. **把 agent 需要发回平台的文本，通过工具 `chat_send` 发送出去**（tool-strict）

> 注意：MCP 是“工具/数据源接入”（Model Context Protocol），不属于消息平台 adapter 配置；MCP 连接由 server/bootstrap 初始化，然后把 `McpManager` 注入给 AgentRuntime 使用。

### 4.2 适配器基类：PlatformAdapter 与 BaseChatAdapter

核心代码：

- `package/src/integrations/platform-adapter.ts`
- `package/src/integrations/base-chat-adapter.ts`

#### PlatformAdapter：输出能力注册（dispatcher）

`PlatformAdapter` 在构造时会注册一个 dispatcher（`registerChatDispatcher()`）：

- dispatcher 的作用：把 `chat_send` 工具的“发送请求”路由回具体平台实现
- 发送入口统一为：`dispatcher.sendText({ chatId, text, ... })`

因此：**Agent 不需要知道 Telegram/飞书怎么发消息，它只需要调用工具 `chat_send`。**

#### BaseChatAdapter：会话复用 + 串行锁 + 聊天记录落盘

`BaseChatAdapter` 在 `PlatformAdapter` 的基础上提供：

- `runtimes: Map<chatKey, AgentRuntime>`：按 `chatKey` 复用一个 `AgentRuntime`（并带 TTL 清理）
- `chatLocks: Map<chatKey, Promise<void>>`：同一 `chatKey` 的串行队列，避免并发污染上下文/审批错配
- `ChatStore`：
  - 把入站用户消息 append 到 `.ship/chats/<chatKey>.jsonl`
  - 启动时可 hydrate 最近消息到 `AgentRuntime` 的对话历史（best-effort）

> `ChatStore` 的实现：`package/src/runtime/chat/store.ts`

### 4.3 “tool-strict” 设计：为什么适配器不直接把 agent output 发出去

当前体系强调：**平台消息发送是工具严格（tool-strict）**。

含义：

- 平台适配器负责“接收消息并触发 run”
- agent 如果需要回复用户，需要显式调用 `chat_send` 工具

这样做的收益：

- agent 可以控制“什么时候发”“发几条”“是否分段/进度”
- 平台差异被隔离在 adapter + dispatcher 内（core 不写死平台格式）
- 更容易把“对外输出”与“内部推理/工具输出”解耦（减少刷屏/泄露工具日志）

### 4.4 典型链路：平台消息 → Agent → 回发消息

```
Telegram/Feishu/QQ 入站消息
  -> Adapter 解析为 IncomingChatMessage
  -> 选择 chatKey
  -> BaseChatAdapter.runAgentForMessage():
       - append user message -> ChatStore(.ship/chats)
       - agentRuntime.run({ instructions, context(chatKey) })
  -> Agent 在 run 过程中调用 chat_send 工具
       -> chat_send 工具从 chatRequestContext 推断 channel/chatId/messageId/messageThreadId/chatType
       -> ChatDispatcher.sendText()
       -> PlatformAdapter.sendTextToPlatform() 发送到平台
       ->（可选）把 bot 输出也 append 到 ChatStore
```

### 4.5 Adapter 如何把“发送消息”整合进 Agent Tool（详细版）

这条链路是“tool-strict”的关键。按调用顺序拆开看：

1) **Adapter 注册发送能力**
- `PlatformAdapter` 构造时调用 `registerChatDispatcher(channel, dispatcher)`
- dispatcher 的 `sendText()` 最终会调用 `adapter.sendToolText()`，再由 `sendTextToPlatform()` 发到平台

2) **Agent 调用工具 `chat_send`**
- tool 定义在 `package/src/tool/chat.ts`
- tool 会从 `chatRequestContext` 读取当前运行上下文（source/chatId/messageId/messageThreadId/chatType）
- 然后调用 `getChatDispatcher(channel).sendText(...)`

3) **谁来写入 `chatRequestContext`？**
- `AgentRuntime` 在执行一次 run 时，用 `withChatRequestContext(...)` 把 `AgentInput.context` 写入异步上下文存储
- 因此工具在 `execute()` 阶段能“感知这次 run 是从哪个平台/哪个 chatKey 触发的”

4) **发回平台并落盘**
- dispatcher → adapter → 平台 SDK 发出消息
- `PlatformAdapter.sendToolText()` 会 best-effort 把 bot 输出追加到 `ChatStore`（`.ship/chats/*.jsonl`）

> 总结：adapter 负责“怎么发”，agent 通过 `chat_send` 决定“发什么/何时发/发几条”。

### 4.6 幂等去重：为什么同一条平台消息不能触发多次

平台可能重复投递消息（重启、重试、offset 不稳定、多实例同时 poll 等）。

ShipMyAgent 提供了**持久化的 ingress 去重**：

- `package/src/runtime/chat/idempotency.ts`
- 通过创建一个“claim marker”文件来实现原子去重：
  - `.ship/.cache/ingress/<channel>/<encode(chatKey)>/<encode(messageId)>.json`

适配器通常会在处理入站消息前调用该方法：若 `claimed: false` 则跳过处理。

### 4.7 ChatKey：平台侧“会话”的统一理解

在当前实现中，`chatKey` 决定隔离粒度。

推荐理解：

- **chatKey = “平台中的一个对话载体”**
  - 私聊：`<platform>:chat:<dmId>`
  - 群聊：`<platform>:chat:<groupId>`
  - 话题/帖子：可进一步包含 `messageThreadId`（视平台能力）

飞书当前实现：`feishu:chat:<chatId>`（见 `package/src/integrations/feishu.ts` 的 `buildChatKey()`）。

> 不同平台的“群/话题/频道”定义不同，适配器最关键的工作之一就是把它映射为稳定的 chatKey。

---

## 5. 任务系统（Tasks / Runs）与 Adapters 的关系

任务系统提供两类触发：

1. **即时指令**：来自平台消息 / HTTP API / CLI，直接调用 `TaskExecutor.executeInstructions()` → `AgentRuntime.run()`
2. **计划任务**：来自 `cron` 调度（`.ship/tasks/*.md`）→ enqueue run → `RunWorker` 拉取执行

当任务需要“通知到平台”时，通常会依赖 `chat_send`（或任务/通知模块封装）把结果推送回指定 channel/chat。

---

## 6. 如何新增一个平台 Adapter（实现思路）

实现一个新的“聊天类平台”适配器，推荐流程：

1. 新建 `package/src/integrations/<platform>.ts`，继承 `BaseChatAdapter`
2. 实现最小两件事：
   - `getChatKey()`：把平台的 chat/topic 映射成稳定 `chatKey`
   - `sendTextToPlatform()`：把 dispatcher 的 sendText 真正发到平台
3. 在入站处理前接入去重：
   - 以 `messageId` + `chatKey` 调用 `tryClaimChatIngressMessage()`
4. 在 `start.ts` 中按 `ship.json.adapters.<platform>.enabled` 启动该 adapter
5. 如果平台有按钮/回调等“审批快捷交互”，把它们统一转成用户文本回复再交给 `AgentRuntime.handleApprovalReply()`（保持 core 的审批状态机不变）

---

## 7. 关键目录速查

- `package/src/runtime/agent/*`：AgentRuntime、模型/工具组装、审批恢复、prompt 拼接
- `package/src/tool/*`：工具集合（含 `chat_send`、`exec_shell`、MCP tools 等）
- `package/src/runtime/permission/*`：权限与审批（`.ship/approvals`）
- `package/src/runtime/chat/*`：聊天记录落盘（`.ship/chats`）、dispatcher、去重
- `package/src/integrations/*`：平台适配器（Telegram/飞书/QQ）
- `package/src/runtime/mcp/*`：MCP 管理（`.ship/mcp/mcp.json`）
- `.ship/`：项目运行状态目录（init 创建）

---

## 8. 一句话总结（边界清晰版）

- **AgentRuntime**：负责“思考 + 工具调用 + 审批 + 记忆 + 上下文管理”
- **Adapters（平台适配器）**：负责“把平台消息变成一次 run，并把 run 过程中的 `chat_send` 发送回平台”
- **二者通过工具与 dispatcher 解耦**：agent 不知道平台细节，平台也不直接替 agent 决定要说什么
