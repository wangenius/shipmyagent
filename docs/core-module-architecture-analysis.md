# Core 模块结构分析（System Provider 架构版）

## 1. 目标边界（一步到位）

当前 core 按三层职责划分：

- `core/session`：只负责 session 历史、调度、请求上下文、session manager
- `core/runtime`：只负责执行链路（模型调用、tool-loop、history resync）
- `core/prompts`：只负责 prompt 聚合机制，不直接实现 skills/memory 业务装载

关键点（中文）
- 不做向后兼容路径，直接统一到 provider 架构
- skills/memory 的发现与加载逻辑都下放到 `intergrations/*`

---

## 2. prompts 新内核：System Provider Registry

新增：`core/prompts/system-provider.ts`

核心能力：

- `registerSystemPromptProvider` / `unregisterSystemPromptProvider`
- `clearSystemPromptProviders` / `listSystemPromptProviders`
- `collectSystemPromptProviderResult`

Provider 契约定义在：`types/system-prompt-provider.ts`

- `SystemPromptProviderContext`：`projectRoot/sessionId/requestId/allToolNames`
- `SystemPromptProviderOutput`：`messages/activeTools/loadedSkills`
- `SystemPromptProviderResult`：聚合结果（供 runtime 消费）

聚合策略：

- `messages`：顺序拼接
- `activeTools`：多 provider 做交集收敛（最严格限制优先）
- `loadedSkills`：按 id 合并（用于运行态快照）

---

## 3. integrations 下放实现

### 3.1 skills provider

文件：`intergrations/skills/runtime/system-provider.ts`

职责：

- 扫描可用 skills（discover）
- 读取 session 的 `pinnedSkillIds`
- 加载 `SKILL.md` 并生成 loaded skill 列表
- 自动清理失效 pin（不存在/不可读）
- 产出两类 system prompt：
  - skills 概览（原先启动阶段注入）
  - active skills 强约束 prompt（含 `activeTools`）
- 强约束 prompt 生成器位于 `intergrations/skills/runtime/active-skills-prompt.ts`

并同步 session 技能状态快照（integration 内部状态容器）：

- 状态文件：`intergrations/skills/runtime/store.ts` + `intergrations/skills/runtime/types.ts`
- `setSessionAvailableSkills`
- `setSessionLoadedSkills`

### 3.2 memory provider

文件：`intergrations/memory/runtime/system-provider.ts`

职责：

- 读取 profile/session memory markdown
- 直接产出 system messages

说明（中文）
- `memory` 的“抽取/压缩/维护”仍在 `intergrations/memory/runtime/service.ts`
- `memory` 的“注入 prompt”也在 integration provider 中完成

### 3.3 provider 启动注册

文件：`intergrations/system-prompt-providers.ts`

启动时统一注册：

- `skillsSystemPromptProvider`
- `memorySystemPromptProvider`

调用位置：`server/ShipRuntimeContext.ts`

---

## 4. runtime 执行链路变化

文件：`core/runtime/agent-runner.ts`

主变化：

1. 删除 runtime 内嵌的 skills/memory 装载代码
2. 改为调用 `collectSystemPromptProviderResult(...)`
3. `baseSystemMessages = runtimeContext + staticSystems + providerMessages`
4. compact 之后重新聚合 provider，保证 prompt 与 activeTools 一致
5. `prepareStep` 只做执行态处理（history resync + provider overrides）

已移除：

- `core/tools/execution-context.ts`（不再需要 run-scope skill 注入上下文）
- `core/prompts/memory-prompt.ts`（已下放到 memory integration provider）
- `core/prompts/skill-prompt.ts`（skills prompt 生成已下放到 skills integration）
- `core/prompts/skills-state.ts`（skills 运行态状态已下放到 skills integration）

---

## 5. server 初始化变化

文件：`server/ShipRuntimeContext.ts`

变化：

- 不再在启动阶段手动 discover skills 并拼接 `skillsSection`
- `systems` 只保留：`Agent.md + DEFAULT_SHIP_PROMPTS`
- 新增 `registerIntegrationSystemPromptProviders()`

结果（中文）
- 启动逻辑变轻
- skills/memory prompt 生成完全由 integrations provider 负责

---

## 6. 目录职责总结（当前建议）

- `core/session/*`：session 内核（历史/调度/管理）
- `core/runtime/*`：执行内核（模型与 tool loop）
- `core/prompts/*`：prompt 聚合机制（registry + 通用 helper）
- `intergrations/*`：具体能力实现（chat/skills/task/memory/mcp）

这套边界已经满足：

- core 不再耦合 chat/skills/memory 业务细节
- runtime 不再承担技能发现和记忆读取
- prompt 装载能力可以按模块持续扩展
