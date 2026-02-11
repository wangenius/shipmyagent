# ShipMyAgent Tools 重构设计（Bash-first + Service + Module Registry）

## 1. 背景与目标

### 1.1 背景

当前 `package/src/core/tools/builtin/` 内置了多类业务工具：

- `chat_send` / `chat_contact_send`
- `skills_list` / `skills_load`
- `task_list` / `create_task` / `run_task`
- `exec_command` / `write_stdin` / `close_session`

问题是：

1. 工具面过宽，模型需要学习多套接口，心智负担高。
2. 业务能力分散在 Tool 层，不利于 CLI 复用与统一治理。
3. 与 `pi-mono` 的“最小内核 + 可扩展能力层”哲学不一致。

### 1.2 本次重构目标

按你的想法，改成 **Bash-first**：

- 保留 `exec_command/write_stdin/close_session`（command 原语）
- 其他业务能力（chat/skill/task）统一由 `sma` 命令承载
- Agent 通过执行 bash：
  - `sma chat send ...`
  - `sma skill load ...`
  - `sma task create ...`

并且让 `sma start` 后，chat 成为一个可复用服务能力。

---

## 2. 对齐 pi-mono 的设计哲学

从 `pi-mono` 可借鉴的核心原则：

1. **最小工具原语**：只保留“通用、稳定、可组合”的基础工具。
2. **能力上移到可扩展层**：业务能力通过命令/扩展实现，而非塞进内核工具。
3. **统一执行协议**：输入/输出规范统一，便于审计、渲染与调试。
4. **上下文与执行解耦**：核心 loop 不耦合业务，业务靠上下文和能力层完成。

在 ShipMyAgent 中，对应策略是：

- 内核工具只保留 shell 会话工具。
- 业务入口统一改为 CLI 子命令（chat/skill/task）。
- Agent 的 system prompt 只教模型“如何通过 `sma` 命令完成业务动作”。

---

## 3. 关键问题：bash 子进程里能否直接拿到当前 chatKey？

### 3.1 结论（必须明确）

**不能直接拿到。**

原因：

- 现在的 `chatKey` 在 `AsyncLocalStorage`（`chatRequestContext`）里。
- `exec_command` 启动的是独立子进程 shell。
- 子进程无法读取父进程的 `AsyncLocalStorage` 运行时内存。

所以如果不做额外设计，`sma chat send` 在 bash 中拿不到当前会话 `chatKey`。

### 3.2 解决方案（推荐）

在创建 exec 会话时，把 request-scope 上下文注入到子进程环境变量：

- `SMA_CTX_CHAT_KEY`
- `SMA_CTX_CHANNEL`
- `SMA_CTX_CHAT_ID`
- `SMA_CTX_MESSAGE_ID`
- `SMA_CTX_MESSAGE_THREAD_ID`
- `SMA_CTX_CHAT_TYPE`
- `SMA_CTX_USER_ID`
- `SMA_CTX_REQUEST_ID`

`sma` 命令解析目标 chatKey 时使用优先级：

1. 显式参数 `--chat-key`
2. 环境变量 `SMA_CTX_CHAT_KEY`
3. 都没有则报错（要求显式指定）

> 这样既支持“当前会话自动路由”，又支持“跨会话指定 chatKey”。

---

## 4. 目标架构（重构后）

### 4.1 工具层

仅保留：

- `exec_command`
- `write_stdin`
- `close_session`

移除（或不再注册）业务内建 tools：

- `chat_send`
- `chat_contact_send`
- `skills_list`
- `skills_load`
- `task_list`
- `create_task`
- `run_task`

### 4.2 命令层（新的一等能力层）

新增/重构 `sma` 子命令：

- `sma chat send --text "..." [--chat-key xxx]`
- `sma chat context`（打印当前上下文解析结果）
- `sma skill list`
- `sma skill load <skillId> [--chat-key xxx]`
- `sma skill unload <skillId> [--chat-key xxx]`
- `sma task list`
- `sma task create ...`
- `sma task run <taskId>`
- `sma task enable/disable <taskId>`

### 4.3 服务层（chat as service）

`sma start` 启动 daemon 后，提供本地控制面（HTTP）：

- `POST /api/chat/send`
- `POST /api/skill/load`
- `POST /api/task/create`
- `POST /api/task/run`

CLI 命令（`sma chat/skill/task`）统一调用本地 daemon API；
若 daemon 未运行，命令直接失败并提示先启动 `sma start` 或 `sma run`。

### 4.4 模块化封装（chat/task/skills）

这里采用 **Module First**，把 `chat`、`skills`、`task` 都做成标准模块，避免后续新增业务再改 `cli.ts` / `server/index.ts`。

统一模块契约：

```ts
export interface SmaModule {
  name: string; // chat | skills | task | future-module
  registerCli(registry: CliCommandRegistry): void;
  registerServer(registry: ServerRouteRegistry): void;
}
```

统一注册中心：

- `core/intergration/registry.ts`：导出模块列表、注册入口
- `types/module-command.ts`：模块契约与 shared DTO 类型
- `intergrations/chat/module.ts`
- `intergrations/skills/module.ts`
- `intergrations/task/module.ts`

关键点：

- CLI 只做一件事：`registerAllModulesForCli(program)`
- Server 只做一件事：`registerAllModulesForServer(app)`
- 新增模块只需新增一个 module 文件并在 registry 中声明，无需改 CLI/Server 主干。

### 4.5 命令统一注册模型

命令不再散落在 `commands/*.ts` 手工拼装，而是通过 `CliCommandRegistry` 统一声明：

```ts
registry.group("chat", "Chat service commands", (group) => {
  group.command("send")...
  group.command("context")...
});
```

Server route 也通过 `ServerRouteRegistry` 统一声明：

```ts
registry.post("/api/chat/send", chatSendHandler)
registry.post("/api/skill/load", skillLoadHandler)
registry.post("/api/task/run", taskRunHandler)
```

收益：

1. `sma` 命令体验统一（help/错误输出/参数风格一致）
2. Server API 风格统一（鉴权、日志、错误码可中间件化）
3. 后续新增模块（如 `workflow`、`memory`）成本低
4. 对外可以自然演进成 plugin/module 生态

---

## 5. Chat Service 设计



### 4.6 core 与 intergrations 职责边界

- `core/skills/*`：运行时能力（skills 发现、prompt 注入、pinned 元数据语义）
- `intergrations/skills/*`：执行接入层（CLI/HTTP 命令入口与编排）
- 约束：业务能力按 `intergrations/<capability>/` 内聚 `module + service (+ command)`

### 5.1 发送链路

`sma chat send` -> 本地 daemon API -> runtime 内 `sendTextByChatKey` -> dispatcher -> 平台。

### 5.2 为什么必须走 daemon API

因为 dispatcher 是运行时注册在 daemon 进程内存中的：

- CLI 独立进程直接调用 `sendTextByChatKey` 时，通常拿不到 dispatcher（未注册）。
- 走 daemon API 才能复用现有 adapter + dispatcher。

### 5.3 安全

本地控制面需校验内部 token：

- daemon 启动时生成 `serviceToken`
- 写入 `.ship/debug/shipmyagent.daemon.json`
- CLI 调用时自动携带 `Authorization: Bearer <token>`

---

## 6. Skill 命令设计

### 6.1 `sma skill load`

语义：

- 解析 skill（沿用现有 `discoverClaudeSkillsSync`）
- 将 skillId 写入目标 chat 的 `meta.json.pinnedSkillIds`
- 返回可读摘要（id/name/path/allowedTools）

这与现有 tool `skills_load` 行为一致，但入口改为 CLI。

### 6.2 chatKey 规则

- 同样支持 `--chat-key` / `SMA_CTX_CHAT_KEY`
- 未提供 chatKey 时直接失败，不做隐式猜测

---

## 7. Task 命令设计

`task` 本身已是磁盘模型（`.ship/task/...`），CLI 化很自然：

- `create/list`：直接读写 task markdown
- `run`：调用现有 `runTaskNow`
- `enable/disable`：修改 frontmatter.status

其中 `task run` 的 chat 通知仍然通过 runtime 的 `sendTextByChatKey` 完成。

---

## 8. System Prompt 调整

当前 prompt 强制“用户可见输出通过 `chat_send`”。

重构后改为：

- 用户可见输出通过 `sma chat send` 发送
- 当前对话可不传 `--chat-key`（由环境变量注入）
- 跨对话必须传 `--chat-key`

并给出明确示例：

```bash
sma chat send --text "已完成，结果在 .ship/task/xxx/result.md"
sma skill load vercel-react-best-practices
sma task create --task-id daily-report --title "日报" --cron "0 9 * * *" --chat-key telegram-chat-123
```

---

## 9. 代码改造清单（按阶段）

### 阶段 A：建立命令能力（不引入兼容分支，直接切）

1. 先落 `Module Registry`（`SmaModule`/`CliCommandRegistry`/`ServerRouteRegistry`）
2. 落地 `chat-module`，并注册 `sma chat send/context`
3. 落地 `skills-module`，并注册 `sma skill load/unload/list`
4. 落地 `task-module`，并注册 `sma task create/list/run/enable/disable`
5. 各能力模块内聚 `service + module + command`，避免跨目录拆散

### 阶段 B：Service 化

1. `AgentServer` 增加内部 API（chat/skill/task）
2. daemon meta 增加 `port/host/serviceToken`
3. CLI 默认优先走 daemon API

### 阶段 C：Tool 面收缩

1. `createAgentTools()` 中移除 chat/skill/task built-in 注册
2. 保留 `exec_shell`（+ mcp 视策略保留）
3. 更新 runtime prompt 为 Bash-first 指令

### 阶段 D：上下文透传

1. 在 `exec_command` 创建子进程时注入 `SMA_CTX_*` 环境变量
2. CLI chat/skill/task 统一实现 `chatKey` 解析优先级

---

## 10. 模块与类型拆分建议（避免超长模块）

遵循“单模块尽量 < 800-1000 行”：

- `package/src/types/module-command.ts`
- `package/src/core/intergration/registry.ts`
- `package/src/core/intergration/cli-registry.ts`
- `package/src/core/intergration/server-registry.ts`
- `package/src/intergrations/chat/module.ts`
- `package/src/intergrations/skills/module.ts`
- `package/src/intergrations/task/module.ts`
- `package/src/intergrations/chat/service.ts`
- `package/src/intergrations/skills/service.ts`
- `package/src/intergrations/task/service.ts`
- `package/src/types/module-command.ts`

关键类型统一放 `package/src/types/`。

> 说明：
> - 能力相关命令实现与 service 统一收敛到各自模块目录（如 `intergrations/skills/*`）。
> - 核心注册逻辑统一进 `core/intergration/*`。

---

## 11. 风险与对策

1. **风险：模型不再调用 `chat_send`，导致无回包。**
   - 对策：prompt 强化 `sma chat send`；`sendFinalOutputIfNeeded` 保留兜底。

2. **风险：daemon 未启动时 `sma chat send` 失败。**
   - 对策：CLI 返回明确错误并提示 `sma start`。

3. **风险：chatKey 缺失导致发错会话。**
   - 对策：严格优先级 + 缺失即失败，禁止隐式推断。

4. **风险：命令输出不可审计。**
   - 对策：统一命令输出 JSON（`--json`），并在 Agent 总结中只呈现摘要。

---

## 12. 最终结论

你的方向可行，并且与 `pi-mono` 哲学一致：

- **工具收敛**：只留 command 原语
- **能力上移**：chat/skill/task 全部命令化
- **服务承载**：`sma start` 提供统一业务服务面
- **上下文可控**：通过 `SMA_CTX_*` 解决 chatKey 透传

其中你问的核心点：

> “tool 调用时，是否可以直接拿到当前会话 chatKey？”

答案是：

- 在当前进程的 tool 内可以（`chatRequestContext`）。
- 在 bash 子进程里默认不可以，必须靠环境变量注入或显式参数传递。
