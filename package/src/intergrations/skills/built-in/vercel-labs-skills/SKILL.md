---
name: Vercel Labs Skills 快速开始
description: 用 sma skill 查找/安装 Vercel Labs skills，并在 ShipMyAgent 中加载使用
allowed-tools:
  - exec_command
  - write_stdin
---

# Vercel Labs Skills 快速开始

本 skill 帮你把常用 Vercel Labs skills 安装到 `~/.ship/skills`，并在当前会话绑定的 chatKey 下加载使用。

## 1) 查找你需要的 skill

使用 `exec_command`：

- `sma skill find react`
- `sma skill find nextjs`
- `sma skill find design`

## 2) 安装推荐 skills（全局）

使用 `exec_command`：

- `sma skill add vercel-labs/agent-skills@vercel-react-best-practices`
- `sma skill add vercel-labs/agent-skills@web-design-guidelines`
- `sma skill add vercel-labs/agent-skills@agent-browser`

## 3) 在当前会话加载并执行

使用 `exec_command`：

- `sma skill list --json`
- `sma skill load vercel-react-best-practices --json`

说明：

- `sma skill load` 会优先使用当前上下文里的 `chatKey`。
- 加载后请严格遵循对应 SKILL.md 的步骤与约束。
