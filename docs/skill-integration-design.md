# Skill Integration 设计与实现说明

## 1. 文档目标

这份文档说明当前 `package` 中 **skill integration** 的完整实现逻辑，覆盖：

- 模块接入方式（CLI / Server）
- 技能发现与加载机制
- `pinnedSkillIds` 持久化策略
- 运行时如何注入 system prompt
- `allowedTools` 如何收敛为 `activeTools`
- 关键文件索引与排查路径

---

## 2. 架构总览

当前 skill integration 不是“独立插件进程”，而是走统一模块化架构：

1. `skillsModule` 作为标准 `SmaModule` 接入核心 registry。
2. `sma skill ...` 命令和 `/api/skill/*` 路由由同一模块对外暴露。
3. `load/unload` 修改的是 **context 级别** 元数据（`meta.json.pinnedSkillIds`）。
4. Agent 每次 run 期间，skills provider 读取 pinned 状态，把技能内容注入 system prompt。
5. 若技能定义了 `allowedTools`，会进一步生成 `activeTools`，约束当轮可用工具。

一句话：**skill 的“启用状态”是持久化在 context 元数据中的，真正生效发生在每次 Agent 执行时。**

---

## 3. 模块接入层（CLI / Server）

### 3.1 注册入口

- `package/src/core/intergration/registry.ts`
  - `MODULES` 中包含 `skillsModule`
  - `registerAllModulesForCli(...)` 统一注册模块命令
  - `registerAllModulesForServer(...)` 统一注册模块路由

### 3.2 CLI 挂载入口

- `package/src/cli.ts`
  - 调用 `registerAllModulesForCli(program)`
  - 因此 `skill` 命令树自动接入主 CLI

### 3.3 Server 挂载入口

- `package/src/server/index.ts`
  - 调用 `registerAllModulesForServer(this.app, getShipIntegrationContext())`
  - 因此 `skillsModule.registerServer(...)` 暴露的 API 自动生效

### 3.4 skillsModule 命令与路由

- `package/src/intergrations/skills/module.ts`
  - CLI 子命令：
    - `skill find`
    - `skill add`
    - `skill list`
    - `skill load`
    - `skill unload`
    - `skill pinned`
  - Server 路由：
    - `GET /api/skill/list`
    - `POST /api/skill/load`
    - `POST /api/skill/unload`
    - `GET /api/skill/pinned`

---

## 4. 两类 skill 命令

## 4.1 本地命令（不依赖 runtime server）

- 实现文件：`package/src/intergrations/skills/command.ts`
- 命令：
  - `skill find` / `skill add`
    - 复用 `npx skills`
  - `skill list`
    - 本地扫描可发现技能并打印
- 关键点：
  - `skill add -g` 后会把 `~/.claude/skills` 同步到 `~/.ship/skills`
  - 这是为了让 ShipMyAgent 扫描路径可直接发现新安装技能

## 4.2 运行时命令（依赖 runtime server）

- `skill load` / `skill unload` / `skill pinned`
- CLI 侧调用 daemon API（`callDaemonJsonApi`）转发到 `/api/skill/*`
- 这些命令会触达 context 元数据，影响后续 Agent run 的提示与工具权限

---

## 5. 数据持久化模型：pinnedSkillIds

skill 的加载状态以 context 为粒度持久化：

- 文件路径：
  - `.ship/context/<encodedContextId>/messages/meta.json`
- 字段：
  - `pinnedSkillIds: string[]`

相关实现：

- 读写入口：`package/src/intergrations/skills/service.ts`
  - `readPinnedSkillIds(...)`
  - `writePinnedSkillIds(...)`
  - `loadSkill(...)` / `unloadSkill(...)`
- 路径工具：
  - `package/src/utils.ts`
  - `getShipContextHistoryMetaPath(...)`
- core 历史仓库对 meta 的统一结构支持：
  - `package/src/core/context/history-store.ts`
  - `package/src/core/types/context-messages-meta.ts`

注意：当前模块内参数仍叫 `chatKey`，语义上即 `contextId`（兼容命名）。

---

## 6. Skill 发现机制（Discovery）

实现文件：`package/src/intergrations/skills/runtime/discovery.ts`

发现流程：

1. 解析扫描根目录（`paths.ts`）
2. 逐目录查找 `<skill-id>/SKILL.md`
3. 解析 frontmatter（name/description/allowed-tools）
4. 按 `id` 去重并排序输出

默认扫描根：

- 项目：`.ship/skills`
- 用户：`~/.ship/skills`
- 配置扩展：`ship.json.skills.paths`（受 `allowExternalPaths` 控制）

路径决策逻辑在：

- `package/src/intergrations/skills/runtime/paths.ts`

---

## 7. 运行时生效链路（核心）

## 7.1 provider 注册时机

- `package/src/server/ShipRuntimeContext.ts`
  - `initShipRuntimeContext(...)` 最后调用 `registerIntegrationSystemPromptProviders(...)`
- `package/src/server/system-prompt-providers.ts`
  - 注册 `createSkillsSystemPromptProvider(...)`

## 7.2 每次 Agent run 如何消费 provider

- `package/src/core/runtime/agent-runner.ts`
  - `collectSystemPromptProviderResult(...)`
  - 将 provider 返回的 `messages` 拼进 system prompt
  - 将 provider 返回的 `activeTools` 注入 step overrides

## 7.3 skills provider 内部流程

实现文件：`package/src/intergrations/skills/runtime/system-provider.ts`

每次调用 `provide(ctx)` 的步骤：

1. 发现当前项目可用 skills（discovery）
2. 从 `historyStore.loadMeta()` 读取 `pinnedSkillIds`
3. 根据 pin 列表加载 SKILL.md 内容，构造 `LoadedSkillV1`
4. 如果 pin 中有无效项（文件缺失等），自动清理并回写
5. 输出两类内容：
   - `messages`: 技能概览 + active skills 强约束文本
   - `activeTools`: 若技能声明 `allowedTools`，生成工具白名单

---

## 8. 工具权限收敛（allowedTools -> activeTools）

实现文件：`package/src/intergrations/skills/runtime/active-skills-prompt.ts`

规则：

1. 汇总所有已加载技能的 `allowedTools`
2. 自动并入执行基础工具：
   - `exec_command`
   - `write_stdin`
   - `close_context`
3. 与当前全量工具集合求交集，过滤不存在工具
4. 作为 `activeTools` 返回给 `agent-runner`

结果：

- 模型在当前 step 只能调用 `activeTools` 中的工具
- skill 对工具能力形成硬约束，而非仅提示性文字

---

## 9. Context 级状态缓存（integration 内部）

实现文件：`package/src/intergrations/skills/runtime/store.ts`

用途：

- 缓存某个 `contextId` 的：
  - `allSkillsById`（可用技能）
  - `loadedSkillsById`（已加载技能）
- 用于 runtime 观察与调试，不替代落盘事实源

事实源仍然是：

- `meta.json.pinnedSkillIds`

---

## 10. 请求链路示例

## 10.1 `sma skill load playwright`

1. CLI 命令进入 `skills/module.ts`
2. 解析 chatKey/contextId（优先显式参数，再环境变量）
3. 调用 `/api/skill/load`
4. server 进入 `skills/service.ts::loadSkill`
5. 扫描并匹配技能
6. 回写 `meta.json.pinnedSkillIds`
7. 返回成功

## 10.2 下一条用户消息到来时

1. `agent-runner` 收集 provider 结果
2. skills provider 读取刚写入的 `pinnedSkillIds`
3. 注入对应 SKILL.md 到 system prompt
4. 若有 `allowedTools`，生成并应用 `activeTools`
5. 本轮模型按技能 SOP + 工具白名单执行

---

## 11. 关键文件索引

- 模块注册
  - `package/src/core/intergration/registry.ts`
  - `package/src/cli.ts`
  - `package/src/server/index.ts`
- skills 模块入口
  - `package/src/intergrations/skills/module.ts`
  - `package/src/intergrations/skills/types/skill-command.ts`
- 命令实现
  - `package/src/intergrations/skills/command.ts`
- 服务与持久化
  - `package/src/intergrations/skills/service.ts`
  - `package/src/utils.ts`
  - `package/src/core/context/history-store.ts`
- runtime 生效
  - `package/src/server/system-prompt-providers.ts`
  - `package/src/intergrations/skills/runtime/system-provider.ts`
  - `package/src/intergrations/skills/runtime/active-skills-prompt.ts`
  - `package/src/core/prompts/system-provider.ts`
  - `package/src/core/runtime/agent-runner.ts`
- 扫描与模型
  - `package/src/intergrations/skills/runtime/paths.ts`
  - `package/src/intergrations/skills/runtime/discovery.ts`
  - `package/src/intergrations/skills/types/claude-skill.ts`
  - `package/src/intergrations/skills/types/loaded-skill.ts`

---

## 12. 调试建议

1. 先看 pin 是否写入成功：
   - `.ship/context/<encodedContextId>/messages/meta.json`
2. 再看 skill 是否可发现：
   - 运行 `sma skill list`
3. 若已 pin 但未生效，重点看：
   - `runtime/system-provider.ts` 中 SKILL.md 读取是否为空
   - `agent-runner.ts` 中 `collectSystemPromptProviderResult(...)` 是否执行
4. 若工具被拒绝，检查：
   - skill frontmatter 的 `allowed-tools`
   - `activeTools` 是否收敛掉了目标工具

