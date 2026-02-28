---
name: Task System（定时任务）
description: 在 ShipMyAgent 中通过 sma 命令创建/列出/执行 Task，并理解 cron 调度与审计落盘
allowed-tools:
  - exec_command
  - write_stdin
---

# Task System（定时任务）

本 skill 用于指导你使用 ShipMyAgent 的 Task 系统（任务定义 + cron 调度 + 执行审计）。

## 任务目录结构（约定）

Task 存放在项目目录：

```text
./.ship/task/
  <task_id>/
    task.md
    <timestamp>/
      messages.jsonl
      *.md
```

- `task.md`：任务定义（frontmatter + 正文）
- `<timestamp>/`：一次执行的 run 目录（审计与过程文件都在这里）

## task.md 的 frontmatter（必须字段）

`task.md` 顶部必须包含 YAML frontmatter，并至少包含：

- `title`
- `cron`
- `description`
- `chatKey`
- `status`

如果你需要“仅手动执行”的任务：建议 `cron: "@manual"`。

## 常用工作流（Bash-first）

### 1) 列出任务

使用 `exec_command` 执行：

- `sma task list --json`

### 2) 创建任务

使用 `exec_command` 执行：

- `sma task create --title "..." --description "..." --chat-key "..." --cron "@manual" --status paused --json`

建议：

- `status` 初始设为 `paused`，确认正文无误后再启用
- `chatKey` 指向你希望接收结果的对话

### 3) 手动执行一次（验证）

使用 `exec_command` 执行：

- `sma task run <task_id> --json`

执行完成后：

- 在 `./.ship/task/<task_id>/<timestamp>/` 查看 `result.md` / `output.md` / `input.md` / `messages.jsonl`
- 系统会向 `chatKey` 发送执行结果

## 编写任务正文建议

任务正文建议写清楚：

- 目标与输出格式（希望产出哪些文件）
- 必须遵守的工具约束
- 若需 SOP，可先执行 `sma skill list` / `sma skill load <name>`
