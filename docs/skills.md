# Skills（Claude Code 兼容）实现说明

本文描述 ShipMyAgent 当前版本对 **Claude Code-compatible skills** 的支持方式：技能如何在磁盘上组织、如何被发现、如何暴露给 Agent（工具层与提示词层）、以及如何通过 `ship.json` 配置扫描路径。

> 代码入口（建议配合阅读）：
> - Skill 发现：`package/src/runtime/skills/discovery.ts`
> - Skill 搜索路径：`package/src/runtime/skills/paths.ts`
> - Skills 提示词 section：`package/src/runtime/skills/prompt.ts`
> - Skills 工具：`package/src/tool/skills.ts`
> - Agent 工具集组装：`package/src/tool/toolset.ts`、`package/src/runtime/agent/tools.ts`
> - （可选）把 skills section 拼进 Agent.md：`package/src/runtime/agent/factory.ts`

---

## 1. Skills 在磁盘上的目录结构

ShipMyAgent 以 “一个目录 = 一个 skill” 的方式扫描 skills root。默认 root 为项目根目录下的：

```
.claude/skills/
  <skill-id>/
    SKILL.md
    (可选) scripts/
    (可选) assets/
    ...
```

- `<skill-id>`：目录名，会作为 skill 的 `id` 使用。
- `SKILL.md`：必须存在，否则该目录不会被识别为 skill。
- 隐藏目录（以 `.` 开头）会被跳过。
- 目录项如果是符号链接（symlink），会尝试 `stat` 判断是否指向目录；不是目录则跳过。

### 1.1 SKILL.md 的元数据（front matter）

`discoverClaudeSkillsSync` 会读取 `SKILL.md` 的 front matter（YAML）来抽取元数据：

- `name`：显示名称；缺省时用目录名 `<skill-id>`。
- `description`：描述（可空）。
- `allowed-tools` / `allowedTools` / `allowed_tools`：工具白名单提示（见后文）。

示例（仅展示 front matter 的关键字段）：

```md
---
name: PDF Miner
description: Extract text & metadata from PDFs
allowed-tools:
  - exec_shell
  - read_file
---

# PDF Miner
...
```

> 注意：目前 `allowed-tools` **只作为元数据/提示**（工具侧返回给模型、提示词层展示），并不会在 ToolExecutor 层面强制阻断不在白名单的工具调用。

---

## 2. Skills 扫描路径（skills roots）

### 2.1 默认与自定义路径

扫描路径由 `getClaudeSkillSearchPaths(projectRoot, config)` 计算：

- 默认路径：`.claude/skills`
- 可在 `ship.json` 中通过 `skills.paths` 添加额外 roots（相对路径相对项目根目录解析；`~` 会被展开；绝对路径会被 normalize）。

对应配置（`ShipConfig.skills`，见 `package/src/utils.ts`）：

```json
{
  "skills": {
    "paths": [".claude/skills", ".my/skills"],
    "allowExternalPaths": false
  }
}
```

### 2.2 “自动补一层 skills/” 的规则

为了兼容一些项目把 skills 放在 `<root>/skills/` 的布局，路径解析有一个“补一层”的逻辑：

如果某个 root 的 basename 不是 `skills`，且该 root 下存在子目录 `skills/`，则优先使用 `<root>/skills/` 作为实际扫描目录。

例：

- 配了 `".claude"`，实际会扫描 `".claude/skills"`（如果存在）。

### 2.3 外部路径与安全

`discoverClaudeSkillsSync` 在扫描阶段会做“是否在项目内”的限制：

- 默认 `allowExternalPaths=false`：只扫描 `projectRoot` 的子路径（避免读到项目外的技能目录）。
- 开启 `allowExternalPaths=true`：允许扫描绝对路径或 `~` 展开的外部路径。

---

## 3. Skills 如何暴露给 Agent

ShipMyAgent 里 skills 有两条“暴露通道”：

### 3.1 工具通道：`skills_list` 与 `skills_load`

在工具层，skills 以两个 AI Tool 形式提供（见 `package/src/tool/skills.ts`）：

- `skills_list`：扫描 skills roots，返回 skills 列表（`id/name/description/allowedTools`）。
- `skills_load`：按 `id` / `name` / `name includes` 查找 skill，读取并返回其 `SKILL.md` 全文及路径信息。

这些 tools 会被 `createAgentToolSet` 合并进 Agent 的 toolset（见 `package/src/tool/toolset.ts`），因此 **模型可以在运行时自行发现并加载 skill 文档**，再按 `SKILL.md` 的指引执行。

### 3.2 提示词通道：Skills Prompt Section（可选）

另一个通道是把“skills 摘要”拼进 system prompt（`Agent.md` 拼接结果），用于让模型在对话开始就知道：

- skills roots 是哪些
- 应优先用 `skills_list` / `skills_load` 来发现与加载 skills
- 当前发现了哪些 skills（最多列出 40 个）

这一段由 `renderClaudeSkillsPromptSection` 生成（`package/src/runtime/skills/prompt.ts`），并且在 `createAgentRuntimeFromPath` 中拼接进最终的 `agentMd`（见 `package/src/runtime/agent/factory.ts`）。

### 3.3 system prompt 中的 skills section

当前 `shipmyagent start` 与各聊天适配器默认都会走 `createAgentRuntimeFromPath`（见 `package/src/runtime/agent/factory.ts`），因此最终的 system prompt（`Agent.md` 拼接结果）会包含 skills 摘要 section，用于让模型在一开始就知道：

- skills roots 是哪些
- 应优先用 `skills_list` / `skills_load` 来发现与加载 skills
- 当前发现了哪些 skills（最多列出 40 个）

---

## 4. 推荐的使用方式（面向用户/维护者）

### 4.1 在 Agent.md 中加一段“如何用 skills”的规则

如果你希望模型稳定地“先查 skills 再行动”，建议在项目 `Agent.md` 加一段约束：

- 先调用 `skills_list` 判断是否有合适的 skill
- 再用 `skills_load` 读取 `SKILL.md`
- 严格遵循 `SKILL.md` 的步骤和 `allowed-tools` 约束（如果存在）

### 4.2 在 ship.json 中只开放可信技能目录

保持 `allowExternalPaths=false`（默认）并控制 `skills.paths`，能避免模型“扫描到项目外目录”带来的风险面扩大。
