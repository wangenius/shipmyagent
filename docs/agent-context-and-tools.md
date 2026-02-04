# Agent：上下文管理与工具执行（实现说明）

本文面向开发者，解释当前 `package` 里 Agent（`ToolLoopAgent`）的两块核心实现：

- 上下文管理：LLM 会话 messages 的组织、压缩与持久化摘要
- 工具执行：内置工具 + MCP 工具的装配、执行与“运行中上下文注入”

> 代码以 `package/src/core/agent/agent.ts` 为入口。

---

## 1. 总览：一次 run 的数据流

核心链路（省略非关键日志/遥测细节）：

1. `createAgent()` 读取 `Agent.md` + 内置 `DEFAULT_SHIP_PROMPTS` + skills 概览，组成 `systems`（system prompts）
2. `Agent.initialize()` 创建模型 `createModel()`，组装工具集 `createAgentToolSet()`，实例化 `ToolLoopAgent`
3. `Agent.run()`：
   - 从 `ContextStore` 取到该 `chatKey` 的 **in-memory 会话 messages**
   - 组装本次 `inFlightMessages = history + [{role:"user", content:userText}]`
   - 用 `withToolExecutionContext(...)` 把“本次运行的可注入上下文能力”挂到 `AsyncLocalStorage`
   - 调用 `this.agent.generate({ messages, onStepFinish })`
4. `onStepFinish`：
   - 抽取用户可读文本（`extractUserFacingTextFromStep`）并回调 `onStep({type:"assistant"})`
   - 把工具执行摘要（`emitToolSummariesFromStep`）回调 `onStep({type:"step_finish"})`
5. 结果落地：
   - 把本轮 user + assistant/tool messages 追加到 `ContextStore` 的 in-memory history
   - 超限时压缩 in-memory history（`compactChatHistory`）
   - 生成 `toolCalls` 摘要并写入 `.ship/memory/agent-context/<chatKey>.jsonl`

关键点：**ChatStore 的 transcript 与 Agent 的 in-memory messages 是两条链**，注入方式也不同（见后文）。

---

## 2. 上下文管理：三条“上下文链”

当前实现里，和“上下文”相关的数据大致分三类：

### 2.1 System prompts（初始化时确定）

入口：`package/src/core/agent/factory.ts`

- `Agent.md`（项目根目录）
- `DEFAULT_SHIP_PROMPTS`（`package/src/core/agent/prompt.ts`）
- skills 概览 section（`renderClaudeSkillsPromptSection`）

这些内容在 `Agent.initialize()` 时，通过 `transformPromptsIntoSystemMessages()` 转成 system messages，交给 `ToolLoopAgent` 的 `instructions`。

说明：

- `prompt.ts` 里提供了 `buildContextSystemPrompt(...)`（包含 `chatKey/requestId/渠道` 等），但**当前链路未使用**；目前 `chatKey/requestId` 主要用于日志与 telemetry（`withLlmRequestContext`）。

### 2.2 LLM 会话 messages（in-memory，按 chatKey）

入口：`package/src/core/agent/context-store.ts`

`ContextStore` 维护：

- `chatMessagesByChatKey: Map<string, ModelMessage[]>`
- 作用：作为下一轮 LLM 输入的“对话 messages cache”（包含 `user/assistant/tool`）

写入点：`package/src/core/agent/agent.ts`

- 每次 `generate` 完成后：
  - `history.push({ role: "user", content: userText })`
  - `history.push(...result.response.messages)`
- 超过 `config.context.chatHistory.inMemoryMaxMessages`（默认 60）时：
  - `compactChatHistory(chatKey, { keepLast })`（默认保留最后 30 条）

压缩策略（当前版本）：

- 把更早的 messages 合并成 **一条** `assistant` summary message
- 再拼接最近的 `keepLast` 条 messages

### 2.3 可持久化的 agent 执行上下文（.ship/memory/agent-context）

目的：把“工程向执行摘要”留在磁盘，供后续 run 需要时注入（system 注入）。

写入点：`package/src/core/agent/agent.ts`

- 每次 run 完成后，将 `{requestId, userPreview, outputPreview, toolCalls摘要}` 写入：
  - `.ship/memory/agent-context/<chatKey>.jsonl`
  - API：`ContextStore.appendAgentExecution(...)`
- 超过 `config.context.agentContext.windowEntries`（默认 200）时：
  - `compactAgentExecutionIfNeeded(chatKey, windowEntries)`
  - 策略：把更早的 entries 合并成 1 条 summary entry，保留最近 `window-1` 条

---

## 3. “工具注入上下文”的机制（最关键）

为了让工具能在“本次运行”动态把更多上下文塞进 LLM messages（但又不污染全局/不改写用户原文），实现采用：

- `AsyncLocalStorage` 保存 **本次 run 的 ToolExecutionContext**
- 工具运行时通过 `toolExecutionContext.getStore()` 取得上下文，并进行“消息注入”

入口：`package/src/core/tools/builtin/execution-context.ts`

`ToolExecutionContext` 的核心字段：

- `messages`: 当前 in-flight `ModelMessage[]`（可变引用）
- `systemMessageInsertIndex`: system message 应插入的位置（保证 system 聚合在顶部）
- `currentUserMessageIndex`: 当前 user message 的索引（对话式注入应插在它之前）
- `injectedFingerprints`: 本次 run 的去重集合
- `maxInjectedMessages`: 单次 run 的注入上限（默认 120）

提供两种注入 API：

- `injectSystemMessageOnce(...)`：注入 system message（用于“规则/约束/工程摘要”）
- `injectAssistantMessageOnce(...)`：注入 assistant message（用于“对话式历史”）

两个重要约束（关键节点，中文说明）：

- **永远不改写用户原始输入**：注入发生在 current user message 之前
- **防止单次 run 无边界膨胀**：去重 + 上限 `maxInjectedMessages`

---

## 4. 工具执行：工具集装配与执行回传

### 4.1 工具集装配：builtin + MCP

入口：`package/src/core/tools/set/toolset.ts`

启动时会：

1. `setToolRuntimeContext({ projectRoot, config })`
2. 合并 builtin 工具：
   - `chat_send`（用户可见内容出口）
- `chat_load_history`（从 `.ship/chats/<chatKey>/history.jsonl` 注入 transcript，assistant 注入）
   - `agent_load_context`（从 `.ship/memory/agent-context` 注入摘要，system 注入）
   - `skills_list / skills_load`（加载 SKILL.md 并 system 注入）
   - `exec_shell`（shell 执行）
3. 注册 MCP 工具：
   - 命名：`${server}:${toolName}`
   - 适配：`createMcpAiTool(...)` 把 MCP schema 包成 AI SDK `tool(...)`

### 4.2 工具执行：由 ToolLoopAgent 驱动

入口：`package/src/core/agent/agent.ts`

- `ToolLoopAgent.generate({ messages, onStepFinish })` 在推理过程中自行决定是否调用工具
- 工具返回被 AI SDK 记录到 `result.steps[].toolResults`
- `agent.ts` 会把每次 tool result 汇总成 `AgentResult.toolCalls[]`
  - 若 tool output 形如 `{ success: false, error/stderr }`，会记录 `hadToolFailure`

### 4.3 step 输出（流式回调）的两层摘要

入口：`package/src/core/agent/tool-step.ts`

在 `onStepFinish` 里做两件事：

1. `extractUserFacingTextFromStep(step)`：尽量从 step 中提取用户可读文本（去掉多余空白），回调 `onStep({type:"assistant"})`
2. `emitToolSummariesFromStep(step, emitStep, {requestId, chatKey})`：
   - 对 `exec_shell`：输出“已执行命令 + exitCode + stdout/stderr 摘要（最多 500 字符）”
   - 对 MCP 工具（`${server}:${tool}`）：输出“已执行 MCP 工具 + 结果摘要（最多 500 字符）”

目标：**用户侧只看到摘要，不直接刷原始工具输出/JSON**（与 `DEFAULT_SHIP_PROMPTS` 的输出约束一致）。

---

## 5. 两个“上下文加载工具”各自解决什么问题

### 5.1 `chat_load_history`：从 ChatStore 注入对话 transcript（assistant 注入）

文件：`package/src/core/tools/builtin/chat-history.ts`

- 来源：`.ship/chats/<chatKey>/history.jsonl`（ChatStore）
- 注入形态：合并为 **一条 assistant message**，插入到当前 user message 之前
- 用途：补齐“用户视角对话历史”（更贴近自然对话）

### 5.2 `agent_load_context`：从 agent-context 注入工程摘要（system 注入）

文件：`package/src/core/tools/builtin/agent-context.ts`

- 来源：`.ship/memory/agent-context/<chatKey>.jsonl`（ContextStore 写入）
- 注入形态：**system message**
- 用途：补齐“工程向执行上下文/约束/近期工具调用概览”（更像规则与执行记录）

---

## 6. 配置项速查（ship.json）

对应类型：`package/src/utils.ts`（`ShipConfig.context`）

- `context.chatHistory.inMemoryMaxMessages`：in-memory messages 最大条数（默认 60）
- `context.chatHistory.compactKeepLastMessages`：压缩后保留最后 N 条（默认 30）
- `context.agentContext.windowEntries`：agent-context 每个 chatKey 的 jsonl 最多条数（默认 200）

---

## 7. 扩展建议（新增工具/新增上下文源）

新增工具的一般路径：

1. 在 `package/src/core/tools/builtin/*` 实现一个 `tool({ inputSchema, execute })`
2. 如需注入上下文：
   - 通过 `toolExecutionContext.getStore()` 拿到当前 run 的 `ToolExecutionContext`
   - 用 `injectSystemMessageOnce` 或 `injectAssistantMessageOnce`
   - 用稳定 fingerprint 做去重（避免重复注入）
3. 在 `package/src/core/tools/set/toolset.ts` 把工具加入 toolset

新增上下文源（例如新的一类持久化摘要）建议遵循现有分层：

- “用户视角 transcript” → assistant 注入（类似 `chat_load_history`）
- “规则/约束/工程摘要” → system 注入（类似 `agent_load_context` / `skills_load`）
