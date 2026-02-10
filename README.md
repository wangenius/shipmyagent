# ShipMyAgent

> **把一个代码仓库，启动成一个可对话、可审计的 Agent Runtime**

ShipMyAgent 是一个 Agent Runtime，它将你的本地或远程代码仓库启动为一个可对话、可执行、可审计的 AI Agent。

> ⚠️ **当前版本说明（2026-02-03）**：已暂时移除 **任务系统（Tasks/Runs/Scheduler）** 与 **权限/审批（Approvals）**，默认 **全权限** 直接执行；后续再重新设计权限体系。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

---

## 为什么选择 ShipMyAgent？

| 对比维度 | GitHub Copilot | ChatGPT/Claude | **ShipMyAgent** |
|---------|---------------|----------------|-----------------|
| **用户** | 个人开发者 | 个人用户 | **团队/企业** |
| **能力** | 代码补全 | 问答对话 | **可执行的 AI 团队成员** |
| **安全性** | 无保障 | 无保障 | ✅ **审计（日志/对话落盘）** |
| **持久性** | 会话级 | 会话级 | ✅ **项目级长期记忆** |

> 💼 **企业版咨询：** [点击了解企业私有化方案](docs/commercial-strategy.md)

---

## 核心特性

- **Repo is the Agent** - 你的代码仓库就是 Agent 的上下文和记忆
- **可对话** - 通过 Telegram / Discord / 飞书与 Agent 交互
- **可执行** - 通过工具（如 `exec_command` + `write_stdin` + `close_session`）直接操作仓库与环境
- **完全可审计** - 日志与对话记录落盘（`.ship/logs` / `.ship/chat/.../conversations`）
- **全权限（临时）** - 当前版本默认不做权限/审批拦截

---

## 快速开始

### 安装

```bash
npm install -g shipmyagent
# 或
pnpm add -g shipmyagent
```

### 初始化项目

在你的项目根目录运行：

```bash
shipmyagent init
```

这会创建以下文件：

- `Agent.md` - Agent 宪法 / 行为规范
- `ship.json` - Runtime 配置
- `.ship/` - Agent 运行时目录

### 启动 Agent

```bash
shipmyagent .
```

Agent 将启动并监听配置的通信渠道（如 Telegram Bot）。

---

## 项目结构

```
your-project/
├─ src/                  # 你的业务代码
├─ Agent.md              # Agent 宪法（必选）
├─ ship.json             # Runtime 配置
├─ .ship/
│   ├─ routes/           # 对外接口（webhook / command）
│   ├─ logs/             # 行为日志
│   ├─ chats/            # 对话记录
│   └─ .cache/           # 运行缓存
└─ README.md
```

---

## 设计文档

- Agent-Native 架构设计草案（vNext）：`docs/agent-native-architecture-design.md`

---

## 配置说明

### Agent.md - Agent 宪法

定义 Agent 的角色、行为边界和决策原则：

```markdown
# Agent Role
You are the maintainer agent of this repository.

## Goals
- Improve code quality
- Reduce bugs
- Assist humans, never override them

## Constraints
- Never modify files without approval
- Never run shell commands unless explicitly allowed
- Always explain your intent before acting

## Communication Style
- Concise
- Technical
- No speculation without evidence
```

### ship.json - Runtime 配置

```json
{
  "name": "my-project-agent",
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5"
  },
  "permissions": {
    "exec_command": {
      "requiresApproval": false,
      "maxOutputChars": 12000,
      "maxOutputLines": 200
    }
  },
  "adapters": {
    "telegram": {
      "enabled": true,
      "botToken": "${TELEGRAM_BOT_TOKEN}"
    },
    "feishu": {
      "enabled": false
    }
  }
}
```

`permissions.exec_command.maxOutputChars` 与 `permissions.exec_command.maxOutputLines` 用于限制工具输出回灌到 LLM 的体积（默认分别为 `12000` 和 `200`），可显著降低第三方 OpenAI-compatible 网关出现 `Parameter error` 的概率。

> 注：启动时会自动加载项目根目录的 `.env`，并把 `ship.json` 里的 `${VAR_NAME}` 形式占位符替换为对应环境变量。

你也可以在 `ship.json` 里配置启动参数（`shipmyagent .` / `shipmyagent start` 会读取），例如：

```json
{
  "start": {
    "port": 3000,
    "host": "0.0.0.0",
    "interactiveWeb": false,
    "interactivePort": 3001
  }
}
```

---

## 使用场景

### 1. Agent as Project Collaborator

让 Agent 成为项目的 24/7 AI 协作者：

```bash
# 启动 Agent
shipmyagent .

# 在 Telegram 中与 Agent 对话
/status          # 查看项目状态
```

### 3. Agent as Interface

直接通过自然语言操作项目，无需写 UI：

```
Telegram Bot = Your Project UI

命令示例：
  /status              # 查看状态
  /clear               # 清空对话上下文
```

---

## 权限与审批（当前版本）

当前版本默认全权限执行，不包含审批流程；如果你需要“默认最小权限 + Human-in-the-Loop”，需要等待后续版本重新设计并回归。

---

## 技术架构

```
┌────────────┐
│ Telegram   │
│ Discord    │
│ Feishu     │
└─────┬──────┘
      │
┌─────▼──────┐
│ Hono Server│  ← Webhook / API / Approval
└─────┬──────┘
      │
┌─────▼────────────────────┐
│ Agent Runtime (Node.js)   │
│ - ToolLoopAgent (ai-sdk)  │
│ - Tools (exec_command/write_stdin/close_session/chat_send/...) │
│ - Approval Flow           │
└─────┬────────────────────┘
      │
┌─────▼──────┐
│ Project FS │
│ Git Repo   │
└────────────┘
```

### 技术栈

- **Agent Core**: ai-sdk v6 ToolLoopAgent
- **Server**: Hono
- **Runtime**: Node.js >= 18.0.0
- **Scheduler**: node-cron
- **Storage**: FS + JSON

---

## 开发路线图

### v1（当前版本）

- [x] 核心 Runtime
- [x] Agent 宪法系统
- [x] 权限引擎
- [x] Telegram 集成
- [x] 声明式任务
- [ ] 完整文档
- [ ] 测试覆盖

### v2（规划中）

- Discord / Slack 集成
- Agent snapshot / replay
- GitHub App
- 多 Agent 协作

### v3（探索中）

- Remote Agent Hosting
- Agent Marketplace
- Web IDE 集成

---

## 设计原则

1. **Repo is the Agent** - 代码仓库是 Agent 的全部上下文
2. **Everything is auditable** - 所有行为可追溯
3. **Minimum privilege** - 默认最小权限
4. **Human-in-the-loop** - 人机协作是第一原则
5. **Declarative over imperative** - 声明式优于命令式

---

## 贡献指南

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详情。

快速开始：

```bash
git clone https://github.com/yourusername/shipmyagent.git
cd shipmyagent
pnpm install
pnpm build
pnpm test
```

---

## 常见问题

### Q: Agent 会修改我的代码吗？

A: 会。当前版本是“简化模式”，默认全权限直接执行（不包含审批）。建议在干净分支上使用，并用 `git diff` / `git status` 随时检查改动。

### Q: 支持哪些 LLM 模型？

A: 支持所有 ai-sdk v6 兼容的模型，包括 Claude、GPT-4、等。

### Q: 可以部署到远程服务器吗？

A: v1 主要支持本地运行，v2 将支持远程部署。

### Q: 安全性如何保证？

A: 当前版本不提供最小权限与审批；只提供审计（`.ship/logs` / `.ship/chat/.../conversations`）与可追溯的执行过程。更严格的权限体系会在后续版本重新设计。

---

## License

MIT © [Your Name]

---

## Links

- [Documentation](https://shipmyagent.dev)
- [GitHub](https://github.com/yourusername/shipmyagent)
- [Twitter](https://twitter.com/shipmyagent)

---

**ShipMyAgent 不是"帮你写代码"，而是定义：一个项目如何被一个 AI 长期、安全、可控地维护。**
