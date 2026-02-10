---
name: Vercel Labs Skills 快速开始
description: 用 npx skills 查找/安装 Vercel Labs skills，并在 ShipMyAgent 中使用
---

# Vercel Labs Skills 快速开始

本 skill 帮你把常用的 Vercel Labs skills 安装到 `~/.ship/skills`，并在 ShipMyAgent 的对话中加载使用。

## 1) 查找你需要的 skill

使用 `exec_command` 执行（必要时用 `write_stdin` 轮询后续输出）：

- `npx skills find react`
- `npx skills find nextjs`
- `npx skills find design`

## 2) 安装推荐的核心 skills（全局）

使用 `exec_command` 依次执行（推荐用 `sma skill add` 安装并同步到 `~/.ship/skills`）：

- `sma skill add vercel-labs/agent-skills@vercel-react-best-practices`
- `sma skill add vercel-labs/agent-skills@web-design-guidelines`
- `sma skill add vercel-labs/agent-skills@agent-browser`

## 3) 在对话里加载并严格遵循

1. 调用 `skills_list` 确认已发现对应 skills
2. 调用 `skills_load` 加载某个 skill（例如：`vercel-react-best-practices`）
3. 按 SKILL.md 的步骤执行（若声明了 `allowed-tools`，尽量遵守工具白名单）
