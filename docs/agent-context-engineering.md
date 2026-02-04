# Agent 上下文工程（Context Engineering）是怎么实现的？

本文档解释：在 ShipMyAgent 里，“**Repo is the Agent**” 这句话在工程实现上具体意味着什么；以及一个 Agent 项目初始化后**目录长什么样**、一次对话请求的上下文是如何被**构建**的。

> 约定：本文以 `package/src`（TypeScript 源码）为准；`package/bin` 为编译产物镜像。

---

## 1. 什么是“上下文工程”

在 ShipMyAgent 的语境里，上下文工程指的是：**把一个代码仓库变成可对话 Agent 的“可控上下文”**，并且让它可以长期运行、可审计、可扩展。

ShipMyAgent 把上下文拆成几类来源（从“最稳定”到“最动态”）：

1) **项目静态上下文（Repo-level）**
   - `Agent.md`：项目的“宪法/角色/边界/行为规范”（系统提示词的一部分）
   - 仓库文件：通过工具按需读取（默认不会把整个仓库塞进提示词）

2) **项目配置上下文（Config-level）**
   - `ship.json`：模型、适配器、技能路径、MCP 等配置
   - `DEFAULT_SHIP_PROMPTS`：运行时内置的默认提示词片段（`package/src/asset/prompts.txt`）

3) **会话动态上下文（Session-level）**
   - 最近对话历史（多轮消息）
   - 运行时元信息（projectRoot/chatKey/requestId/来源渠道等）

---

## 2. 初始化后目录“长什么样”

### 2.1 项目根目录关键文件

最小可运行的 Agent 项目通常包含：

```text
<your-repo>/
├─ Agent.md           # Agent 宪法 / 角色定义（系统提示词来源之一）
├─ ship.json          # 运行配置（模型/适配器/MCP/技能路径…）
└─ .ship/             # 运行时目录（日志、聊天记录、缓存…）
```

`shipmyagent init` 会创建 `Agent.md`、`ship.json` 以及部分 `.ship/` 结构：见 `package/src/commands/init.ts`。

### 2.2 `.ship/` 运行时目录结构

`.ship/` 是“**可审计、可恢复、可扩展**”的工程落点。不同子系统会在启动/运行期间按需补齐目录：

```text
.ship/
├─ routes/            # 路由/动作相关（按项目扩展，部分场景使用）
├─ logs/              # 统一日志（JSONL），见 telemetry/logger
├─ chats/             # 聊天记录（jsonl + archive），见 runtime/chat/store
├─ mcp/               # MCP 配置与 schema，见 runtime/mcp/bootstrap
└─ .cache/            # 幂等/去重/临时缓存（如 ingress 缓存）
```

---

## 3. “上下文”在代码里是怎么拼起来的

### 3.1 AgentRuntime 的创建：把静态上下文拼成 system prompt

入口在 `createAgentRuntimeFromPath()`：`package/src/runtime/agent/factory.ts`。

它做了三件关键事：

1) 读取项目 `Agent.md`（不存在则用默认角色）
2) 拼上内置默认提示词 `DEFAULT_SHIP_PROMPTS`（来自 `package/src/asset/prompts.txt`）
3) 发现并渲染 Skills 概览段（Claude Code 兼容 skills），追加到 system prompt 尾部

最终形成 `agentMd` 并传入 `AgentRuntime`。

### 3.2 每次请求的“动态上下文”：DefaultPrompt + in-memory history + user 原文

每次 `AgentRuntime.run()`（`package/src/runtime/agent/runtime.ts`）都会构造本次请求的 in-flight messages：

1) `system`：`Agent.md` + `DefaultPrompt`（`package/src/runtime/agent/prompt.ts`），包括：
   - Project root / ChatKey / Request ID
   - 消息来源（telegram/feishu/qq/api/cli…）
   - 输出规则（要求用 `chat_send` 回发；不允许给 user 文本加前缀）
2) `history`：同一进程内的 in-memory session（多轮 user/assistant/tool）
3) `user`：用户原文（不加前缀）

因此，一个请求的“可见上下文”大致是：

```text
system:  Agent.md + DefaultPrompt
user:    User instructions (raw)
history: Recent in-memory session messages (trimmed to a fixed bound)
tools:   Toolset (exec_shell/chat_send/chat_load_history/mcp/skills/…)
```

---

## 4. 对话历史是怎么控制长度的（简化版）

为了让 runtime 保持“可预测、可控成本”，ShipMyAgent 对历史上下文采取两条简单策略：

1) **in-memory session 只保留最近 N 条**
   - `AgentRuntime` 会在每轮结束后把本轮 `user + response messages` 追加进 session，并裁剪到固定上限（避免无限增长）。

2) **需要更多上文时显式加载**
   - 模型可调用 `chat_load_history` 从 `.ship/chats/<chatKey>.jsonl` 加载/搜索历史消息，并注入到当前 in-flight messages（不改 user 原文）。

这两个策略覆盖了绝大多数“长对话上下文窗口”问题，同时避免引入复杂的摘要/记忆链路。

---

## 6. 仓库上下文如何进入 Agent（“Repo is the Agent”落地）

关键点是：**仓库不会被一次性塞进提示词**，而是通过“工具访问 + 日志审计”成为可控上下文。

### 6.1 文件读取/搜索/执行：统一走 `exec_shell`

运行时提供 `exec_shell` 工具：`package/src/runtime/tools/exec-shell.ts`。

- 它把工作目录固定在 `projectRoot`
- 允许 agent 使用 `ls/cat/rg/git/test/build…` 等命令按需获取“真实仓库信息”
- 对“破坏性命令”的边界主要通过提示词与产品策略约束（内置提示词明确不建议 `rm -rf` 等）

这就是“Repo as context”的核心工程手段：**按需检索 + 可重放日志**。

### 6.2 聊天记录与可审计性：`.ship/chats/*.jsonl`

适配器会把用户消息 append 到 `ChatStore`：`package/src/runtime/chat/store.ts`，落盘到 `.ship/chats/<chatKey>.jsonl`（超过阈值会归档）。

注：落盘聊天记录用于审计与按需检索；运行时的上下文默认来自 in-memory session。如需加载落盘历史，模型可调用 `chat_load_history`。

### 6.3 Skills 与 MCP：把外部能力也纳入“上下文工程”

- Skills（Claude Code compatible）
  - 发现：`package/src/runtime/skills/discovery.ts`（默认扫描 `.claude/skills`）
  - 使用：通过 `skills_list` / `skills_load` 工具加载 `SKILL.md`，然后按技能指令工作
- MCP（Model Context Protocol）
  - 配置：`.ship/mcp/mcp.json`
  - 启动：`package/src/runtime/mcp/bootstrap.ts`
  - 作用：把数据库、内部 API、外部系统能力接进来，让 Agent 的“上下文”不仅来自仓库，还能来自业务系统

---

## 7. 你如何“做上下文工程”（实用指南）

1) **定义行为边界（最重要）**：编辑 `Agent.md`，把角色、禁止项、输出风格、协作方式写清楚
2) **把项目 SOP 写成 Skills**：在 `.claude/skills/<skill>/SKILL.md` 放入可复用流程（例如发布流程、排查流程、代码规范）
3) **把业务系统接到 MCP**：在 `.ship/mcp/mcp.json` 配置 MCP server（数据库/服务接口等）
4) **关注可审计性**：查看 `.ship/logs/*.jsonl` 与 `.ship/chats/*.jsonl`，追踪每次执行发生了什么
5) **控制上下文成本**：保持 `Agent.md` 清晰、工具能力边界明确；需要更多历史时用 `chat_load_history` 精准补充
