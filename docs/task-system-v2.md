# Task System v2 设计（草案）

目标：把 “任务” 做成一个一等公民的执行单元——既能定时跑，也能一次性跑；既能短平快同步执行，也能把长时间工具调用变成可追踪、可恢复、可查询的异步任务（Runs/Jobs）。

本文基于当前实现（`package/src/runtime/scheduler.ts`、`package/src/runtime/task-executor.ts`、`package/src/server/index.ts`）提出一个兼容演进方案。

---

## 1. 现状与问题

### 1.1 现状（v1）
- Task 定义：`.ship/tasks/*.md`，YAML front matter 只解析了 `id/name/cron/notify/enabled`。
- 触发方式：仅 cron（`node-cron`），`TaskScheduler.start()` 直接调用 `taskHandler(task)`。
- 执行方式：`TaskExecutor.executeTask()` 读取 md 正文，最终仍是 `agentRuntime.run()`（同步等待一个结果字符串）。
- 执行状态：仅内存 `executions: Map<string, TaskExecution[]>`，进程重启就丢。
- API：只有 `/api/execute`（同步执行一段 instructions），没有任务列表/运行记录/取消/流式日志。

### 1.2 不够“性感”的点（v1 缺口）
1. **只有“定时”没有“运行实例”**：一次性任务、手动触发、重试/回放都不自然。
2. **长时间工具调用只能同步阻塞**：Agent 需要“创建任务 → 继续对话 → 随时查结果/自动通知”的异步模型。
3. **不可观测**：没有统一的 runId、状态机、进度、日志流、产物（artifact）概念。
4. **不可恢复**：进程重启后，跑到一半的任务无法判定/续跑/标记失败。
5. **通知模型弱**：`notify` 字段存在但未形成可扩展的“事件 → 通知”通道。

---

## 2. 设计目标（v2）

### 2.1 产品目标
- **统一抽象**：Scheduled / One-shot / Agent-triggered long-running 都是同一种“Run”。
- **异步优先**：执行返回 `runId`；结果可以后取（pull）或订阅（push）。
- **可观测**：状态、阶段、日志、输出、错误、产物、审计都可查。
- **可恢复**：进程重启后，能恢复队列、继续跑或安全地标记终止。
- **可控**：取消、超时、并发限制、重试策略、幂等键（idempotency key）。
- **兼容演进**：保留 `.ship/tasks/*.md` 的形态，逐步把 v1 的“cron+同步”迁移到 v2 的“schedule→run”。

### 2.2 非目标（第一阶段不做）
- 分布式多机调度、复杂 DAG 编排（可以预留接口）。
- 强依赖外部队列/数据库（先用 `.ship/` 文件落盘，后续可替换）。

---

## 3. 核心概念与数据模型

### 3.1 Task（定义）
Task 是“可重复执行的模板”，可以有 schedule，也可以只有描述（用来手动触发）。

建议保留 markdown + front matter，但扩展字段：
```yaml
---
id: daily-todo-scan
name: Daily TODO Scan
kind: scheduled            # scheduled | adhoc
schedule: "0 9 * * *"      # 兼容 cron（原 cron 字段可继续支持）
enabled: true
concurrency: 1             # 同一个 task 的并发上限
timeoutSec: 900
retries: 1
notify:
  - telegram
---
```

正文仍是任务 instructions。

### 3.2 Run（运行实例，一等公民）
Run 是一次具体执行，必须有全局唯一 `runId`。

Run 记录建议落盘（文件/JSON），核心字段：
```json
{
  "runId": "run_20260130_abcdef",
  "taskId": "daily-todo-scan",
  "trigger": { "type": "schedule", "by": "scheduler" },
  "status": "queued",
  "createdAt": "2026-01-30T12:00:00.000Z",
  "startedAt": null,
  "finishedAt": null,
  "timeoutSec": 900,
  "attempt": 1,
  "inputs": { "instructions": "..." },
  "context": { "source": "scheduler", "sessionId": "scheduler:task:daily-todo-scan" },
  "progress": { "phase": "planning", "pct": 0 },
  "outputs": { "text": "", "artifacts": [] },
  "error": null
}
```

状态机（最小集）：
- `queued` → `running` → `succeeded|failed|canceled|timed_out`
- `running` 可进入 `waiting_approval`（与权限/审批系统融合）

### 3.3 Job（长时间工具调用的子任务，可选）
Run 里可能包含多个“长耗时动作”（例如：大仓库扫描、慢查询、耗时编译、外部 API 批处理）。
为避免 Agent 同步阻塞，可引入 Job：
- Job 是 Run 的子资源：`runId + jobId`
- Job 有自己的状态、日志、进度、产物
- Agent 工具调用产生 Job：`tool -> createJob() -> returns jobId`

第一阶段也可以不单独建 Job：直接把“长时间动作”当作一个 Run（由 Agent 创建）。但 Job 抽象能让一次 run 内并行/分阶段更自然。

---

## 4. 执行模型（让长任务“性感”的关键）

### 4.1 两条执行路径
1) **Sync（兼容）**：API/Telegram 输入 → 仍然可以“同步等待输出”，但内部也创建 Run，并在完成后返回结果（便于审计）。

2) **Async（推荐）**：
- 发起时返回：`{ runId, status: queued }`
- 前端/对话端可：
  - `GET /api/runs/:runId` 拉取状态/结果
  - `GET /api/runs/:runId/events`（SSE/WebSocket）订阅事件
- Run 完成后，按 notify 通道自动推送结果摘要 + 查询入口

### 4.2 Agent 触发“工具即任务”
把 “Agent 调用长时间工具” 视为创建一个 Run（或 Job）：
- Agent 立即回复用户：已创建任务（runId），你可以继续聊；需要结果时 `/result <runId>` 或等通知。
- 后台执行：工具执行器把这类调用放入队列，由 worker 异步跑。
- Agent 在后续对话中可以基于 run 结果继续推理（通过 `getRun(runId)`）。

### 4.3 Worker/Queue（本地落盘版）
建议先实现一个单进程 worker：
- `.ship/runs/`：Run 状态落盘
- `.ship/queue/queue.jsonl`（或 `queued/` 目录）：待执行 runId 列表
- “租约/心跳”：`running` 状态写 `leaseUntil`，崩溃后可回收（requeue 或 fail）
- 并发控制：全局并发 + per-task 并发（`concurrency`）

---

## 5. 交互方式（Agent First：一切问 Agent）

你提出的方向很明确：**不需要用户直面 “Task API”**，用户只需要对 Agent 说话。

因此 v2 的交互建议是：
- **对用户**：只暴露自然语言 + 少量命令（可选）。
- **对系统**：内部仍然有 Runs/Queue/Worker/Store；如果有 HTTP Server，它更像是“Agent UI 的代理层”，而不是给用户直接调的 task API。

### 5.1 对话交互（不需要命令）
目标是让用户只用自然语言表达意图，例如：
- “帮我跑一下 daily-report，然后把结果发我”
- “这个任务跑到哪了？”
- “如果需要审批就问我”

Agent 负责：
- 选择是同步完成还是创建后台 Run
- 在需要时主动告知 runId（用于后续引用/审计）
- 在用户追问时读取 run 状态并总结进度/结果

### 5.2 定时任务“回到哪个对话”
定时任务是 scheduler 触发的，本身没有“来源对话”。为了做到“审批/结果自动回到创建任务的对话”，约定：
- 当 Agent 在某个对话里创建/修改 `.ship/tasks/<taskId>.md` 时，要把该对话写入任务 front matter：
  - `source: telegram`（或 `source: feishu`）
  - `chatId: <当前对话 chatId>`
- scheduler 触发该 task 时，会把 run 的 context 路由到 `source/chatId` 指定的对话，从而做到无需配置 `chat_id`、也无需 lastActiveChatId。

### 5.2 HTTP API（内部能力，不强调“tasks”）
如果需要 Web UI 或其他 adapter（例如 Interactive Web/Telegram/Feishu）共用同一套能力，可以保留极少量“run 级别”接口：
- `POST /api/execute`：保持兼容（可同步或异步）
- `GET /api/runs/:runId`：给 UI 拉取状态/结果（内部使用）
- `GET /api/runs/:runId/events`：事件流（SSE/WebSocket，内部使用）

不提供 `/api/tasks` 之类“任务定义 API”，Task 定义仍然是 repo 内 `.ship/tasks/*.md`（或由 Agent 生成/修改）。

---

## 6. 通知与审批的融合

### 6.1 通知（notify）
把通知做成事件驱动：
- 事件：`run.queued/run.started/run.waiting_approval/run.succeeded/run.failed/...`
- 通道：telegram/feishu/webhook/email（先做 telegram/feishu）
- 规则：按 task notify 配置 + run trigger 的来源上下文（比如发起 chat）

### 6.2 审批（approval）
当 Run 内发生权限拦截：
- Run 状态进入 `waiting_approval`
- 记录 approvalId / snapshot
- 通知到“来源 chat” + “最近活跃 chat（fallback）” +（可选）管理员通道
- 审批通过后继续执行并回填 Run

---

## 7. 存储布局建议（.ship）

```
.ship/
  tasks/                 # Task definitions (.md)
  runs/                  # Run records (runId.json)
  queue/                 # queued/running indexes (optional)
  artifacts/             # large outputs, files, reports
  events/                # optional append-only event logs
  logs/                  # existing logger logs
  approvals/             # existing approval snapshots
  cache/
```

原则：
- Run record 小而全；大输出写 artifact，Run 里只存引用。
- 事件 append-only，便于流式订阅与审计。

---

## 8. 演进路线（兼容 v1）

### Phase 1：Run 落盘 + API
- scheduler 触发不再“直接执行”，而是：创建 Run → 入队 → worker 执行
- `/api/execute` 内部也创建 Run（可选同步等待）
- 增加 `/api/runs/*` 查询接口

### Phase 2：异步工具与长任务体验
- 为长时间工具加 async 选项：返回 runId/jobId
- 增加事件流（SSE），UI/Telegram 支持“查看进度/结果”

### Phase 3：更性感的编排
- 多阶段 run（phases）、子 job、重试策略、幂等键、资源限额
- 可选：把 worker 独立成子进程（防止阻塞主 server）

---

## 9. 关键决策点（需要你拍板）

1) “长任务”到底用 **Run** 还是 **Job**（Run 子资源）？
   - 简化：全都用 Run（Agent 创建 run）
   - 完整：Run + Jobs（run 内可并行多个 job）

2) 事件流协议：SSE vs WebSocket？
   - SSE 更简单，服务端实现成本低

3) 存储：纯文件 vs sqlite？
   - 先文件（与 `.ship/` 一致），后续可平滑迁移 sqlite

---

## 10. 下一步（我建议的落地顺序）
1) 先把 “Run 作为一等公民” 做出来：`createRun/enqueue/worker/run store`。
2) 对话端增加 `/runs`、`/result`（以及可选 `/cancel`、`/retry`）。
3)（可选）给 Web UI 加最小的 run 查询接口（不要 tasks API）。
4) 再把长耗时工具改为 async：工具调用返回 runId，不阻塞对话。

---

## 11. 场景化例子（用来校验 v2 是否“性感”）

下面所有例子都遵循同一件事：**用户只和 Agent 对话**；底层由 Run 系统保证可追踪、可查询、可恢复。

### 11.1 定时任务：每天 9 点做日报（Scheduled → Run）

任务文件（repo 内可审计）：
```md
---
id: daily-report
name: Daily Report
schedule: "0 9 * * *"
notify:
  - telegram
timeoutSec: 600
---

请读取最近 24 小时的提交、PR、以及 CI 失败记录，生成一份 10 行以内的中文日报。
```

执行体验：
- 9 点到点：scheduler 创建 `runId=...` → worker 执行 → 写入 `.ship/runs/runId.json`
- 结果产出后：Agent 在 Telegram 主动推送一条摘要 + `runId`
- 你想查细节：直接问 “刚才 daily-report 的 run 结果是什么？”

为什么 v1 不性感：
- v1 只有内存 executions，没有 runId 可查，也无法在对话里“追这个 run”。

### 11.2 一次性任务：让 Agent 生成一个“迁移计划”（Ad-hoc → Run）

用户对话：
> “帮我把项目从 npm 迁到 pnpm，列出所有改动并给出执行顺序”

Agent 行为（内部）：
- 创建 `Run(trigger=chat)`，runId 返回给用户（可选：只在耗时较长时返回）
- 如果可以快速完成：同步返回最终方案
- 如果分析较大：先回复“我开了一个任务在跑，runId=...，你可以继续提需求，结果好了我会发你”

用户后续：
- 直接问 “刚才那个 run 跑完了吗？给我结果/进度”

### 11.3 长耗时工具：代码库全量索引（Tool-as-Task）

场景：你提供一个工具 `index_repo`，需要 5~30 分钟做 AST/embedding/索引。

用户对话：
> “建立索引，之后我问架构问题你要能秒回答”

Agent 回复（立即）：
- “已创建索引任务：runId=run_...，我会在完成后通知你。你也可以随时 `/result run_...`。”

后台执行：
- worker 执行 `index_repo`（可能产生 artifact：`.ship/artifacts/index/...`）
- run 进度阶段：`queued → running(phase=indexing, pct=...) → succeeded`

完成通知：
- “索引完成，耗时 12m，产物已保存，接下来你可以直接问任何模块问题。”

这里的关键点：
- **工具调用变成 Run**，对话不阻塞；run 的产物可复用、可审计、可恢复。

### 11.4 审批等待：Run 进入 waiting_approval，再恢复执行

场景：任务需要执行 `git push`，触发审批。

用户对话：
> “把依赖升级到最新并提交 PR”

执行过程中：
- run 状态变为 `waiting_approval`，记录 approvalId
- Agent 主动推送：
  - “需要你确认：我准备执行 `git push ...`。回复‘同意’或‘拒绝，因为…’”

你回复“同意”后：
- run 恢复 `running`，继续执行
- 最终完成：`succeeded`，并在同一 runId 下可追溯全过程

### 11.5 进程重启：运行可恢复（至少可判定）

场景：服务器重启，某个 run 在 `running` 中。

v2 期望：
- run 记录里有 `leaseUntil`（或最后心跳时间）
- 重启后：
  - 若 lease 过期：重新入队继续跑（或标记 failed 并提示可 retry）
  - 若 lease 未过期：等待（防止重复执行）

用户体验：
- 你问 `/result run_...` 不会“查不到”
- Agent 能解释：这个 run 在重启时被回收并重跑 / 已标记失败可重试
