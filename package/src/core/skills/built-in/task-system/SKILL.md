---
name: Task System（定时任务）
description: 在 ShipMyAgent 中创建/列出/手动执行 Task，并理解 cron 调度与审计落盘
allowed-tools:
  - task_list
  - create_task
  - run_task
  - exec_command
  - write_stdin
  - skills_list
  - skills_load
  - chat_contact_send
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
      history.jsonl
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

如果你需要“仅手动执行”的任务：建议 `cron: "@manual"`（仍满足必须字段要求）。

## 常用工作流

### 1) 列出任务

调用 `task_list` 查看当前项目已有的 tasks 与其状态。

### 2) 创建任务

调用 `create_task` 创建 `./.ship/task/<task_id>/task.md`。

建议：

- `status` 初始设为 `paused` 或 `disabled`，确认正文无误后再启用
- `chatKey` 指向你希望接收结果的对话（与当前系统的 chatKey 机制保持一致）

### 3) 手动执行一次（验证）

调用 `run_task` 手动触发一次执行。

执行完成后：

- 在 `./.ship/task/<task_id>/<timestamp>/` 查看 `result.md` / `output.md` / `input.md` / `history.jsonl`（以及 `run.json` / `error.md` 等）
- 系统会向 `chatKey` 发送一条执行结果消息（成功/失败都会发）

## 编写任务正文的建议

任务正文建议写清楚：

- 目标与输出格式（希望产出哪些文件、摘要结构）
- 必须遵守的工具约束（如只允许 read_repo/write_repo/exec_command/write_stdin）
- 若需要复用 SOP：先调用 `skills_list` / `skills_load` 加载对应 skill，再按其流程执行
