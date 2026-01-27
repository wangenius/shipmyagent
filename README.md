# ShipMyAgent

> **把一个代码仓库，启动成一个可对话、可调度、可审计的 Agent Runtime**

ShipMyAgent 是一个 Agent Runtime，它将你的本地或远程代码仓库启动为一个拥有权限、任务、人格与对外接口的 AI Agent。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

---

## 核心特性

- **Repo is the Agent** - 你的代码仓库就是 Agent 的上下文和记忆
- **可对话** - 通过 Telegram / Discord / 飞书与 Agent 交互
- **可调度** - 声明式任务定义，支持 cron 和事件驱动
- **Human-in-the-Loop** - 所有敏感操作需要人类审批
- **完全可审计** - 所有行为可追溯、可回放
- **权限控制** - 默认最小权限原则，细粒度权限配置

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
│   ├─ tasks/            # 自动任务定义
│   ├─ routes/           # 对外接口（webhook / command）
│   ├─ approvals/        # 待审批行为
│   ├─ logs/             # 行为日志
│   └─ .cache/           # 执行状态 / memory
└─ README.md
```

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
  "model": "claude-sonnet-4-5",
  "entry": "src",
  "permissions": {
    "read_repo": true,
    "write_repo": {
      "paths": ["src/**"],
      "requiresApproval": true
    },
    "exec_shell": {
      "allow": ["npm test"],
      "requiresApproval": true
    }
  },
  "integrations": {
    "telegram": {
      "enabled": true,
      "botToken": "${TELEGRAM_BOT_TOKEN}"
    },
    "feishu": {
      "enabled": false
    }
  },
  "tasks": ".ship/tasks"
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
/suggest refactor auth  # 建议如何重构 auth 模块
/run test        # 运行测试
```

### 2. Agent as Background Worker

创建自动任务，让 Agent 定期维护项目：

在 `.ship/tasks/daily-todo-scan.md` 中定义：

```markdown
---
id: daily-todo-scan
cron: "0 9 * * *"
notify: telegram
---

Scan the repository for TODO comments.
Summarize them by file.
Suggest which ones should be prioritized.
```

### 3. Agent as Interface

直接通过自然语言操作项目，无需写 UI：

```
Telegram Bot = Your Project UI

命令示例：
  /status              # 查看状态
  /tasks               # 查看任务列表
  /suggest <intent>    # 请求建议
  /run <command>       # 执行命令
  /approve             # 审批待处理操作
```

---

## 权限模型

ShipMyAgent 采用三层权限模型：

| Capability | 默认策略 | 说明 |
|-----------|---------|------|
| read_repo | auto | 可以自由读取代码 |
| write_repo | require_approval | 写代码需要审批 |
| exec_shell | require_approval | 执行 shell 需要审批 |
| open_pr | auto | 可以创建 PR |
| merge | deny | 禁止自动 merge |

### 审批流程

1. Agent 生成操作意图（Intent）
2. 推送到配置的通信渠道（Telegram / 飞书）
3. 人类选择：Approve / Reject / Edit & Approve
4. Agent 执行或中断

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
│ - Permission Engine       │
│ - Task Scheduler          │
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

A: 默认不会。所有写操作需要通过 Telegram / 飞书等渠道经过你的审批。

### Q: 支持哪些 LLM 模型？

A: 支持所有 ai-sdk v6 兼容的模型，包括 Claude、GPT-4、等。

### Q: 可以部署到远程服务器吗？

A: v1 主要支持本地运行，v2 将支持远程部署。

### Q: 安全性如何保证？

A: 采用默认最小权限原则，所有敏感操作需要审批，所有行为可审计。

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
