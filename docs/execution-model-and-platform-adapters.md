# ShipMyAgent：平台适配器与执行模型（DM/群聊）、幂等去重、审批执行模型报告

> 范围：这份报告单独聚焦你提的议题：  
> 1) 平台能力“发什么/怎么发”应由 adapter 决定（而不是 core 写死），adapter 也可以向 agent 暴露 tool。  
> 2) 私聊/群聊中的执行模型、幂等与去重：怎么跑、怎么排队、怎么避免重复执行。  
> 3) **当前实现的 approval 执行模型是什么**（基于现有代码），以及它对执行模型的要求。

---

## 1. 关键结论（TL;DR）

1) **Adapter 决定“怎么发”是对的**：core 不应该假设平台支持按钮/卡片/语音/线程回复。core 应该产出“意图（intent）”，adapter 基于 capabilities 渲染成平台消息。
2) **同一对话线程必须单线程执行（per-thread mutex/queue）**：否则会出现 UI/上下文乱序、approval 对不上、重复执行工具。
3) **幂等/去重必须在 core 做持久化**：仅靠内存 Set 或 Telegram 的 update_id 不够，必须以 `platform + messageId` 作为唯一键落盘（或至少写入 thread log）。
4) **当前 approval 模型 = 文件落盘 + tool approval 往返**：PermissionEngine 创建 `.ship/approvals/*.json`；AgentRuntime 把 AI SDK 的 `approvalId` 映射写入 `meta.aiApprovalId`；用户回复后由 `handleApprovalReply()` 生成 `tool-approval-response` 继续 ToolLoopAgent。

---

## 2. 当前代码里的“执行模型 & 审批模型”到底是什么？

### 2.1 AgentRuntime（ToolLoopAgent）侧的审批执行模型（当前实现）

核心文件：`package/src/runtime/agent.ts`

**执行阶段**
- 工具（当前主要是 `exec_shell`）通过 AI SDK v6 `tool({ needsApproval, execute })` 注册。
- 当模型想调用一个 `needsApproval: true` 的工具时，AI SDK 会在 `result.content` 里返回 `tool-approval-request` part（带 AI SDK 自己的 `approvalId`），并暂停自动执行该工具。

**落盘阶段（ShipMyAgent approval）**
- `runWithToolLoopAgent()` 扫描 `tool-approval-request` parts：
  - 对 `exec_shell`：调用 `PermissionEngine.checkExecShell(command)` 创建一个 ShipMyAgent `approvalId`（写入 `.ship/approvals/<approvalId>.json`）。
  - 然后把映射关系写进 approval 文件的 `meta.aiApprovalId`，并保存当时的消息快照 `messages`（用于恢复上下文）。
  - 最后 `AgentRuntime.run()` 返回 `pendingApproval`，让上层（adapter）去提示用户确认。

**恢复阶段（approval reply）**
- adapter 收到用户回复后调用 `AgentRuntime.handleApprovalReply({ userMessage, sessionId, ... })`：
  - 它会从 PermissionEngine 读 pending approvals，并用 `meta.sessionId` / `meta.userId` 做过滤（不同平台写法不一致，见 2.3/2.4）。
  - `decideApprovals()` 会用 LLM（或兜底）把自然语言回复解析成：`approvals/refused/pass`。
  - `resumeFromApprovalActions()` 读取 approval 文件中的 `meta.aiApprovalId`，构造 `tool-approval-response`（AI SDK 格式），再把它作为 `role:'tool'` 的消息写回 session history，然后继续 `runWithToolLoopAgent()`。
  - 同时它会把审批状态写回 approval 文件并删除 `.ship/approvals/<id>.json`（当前策略是“决策后删除”）。

**这里隐含的执行模型要求**
- 由于 approval 需要“往返”并依赖完整上下文，所以：**同一 thread/session 不允许并发跑多个 ToolLoopAgent**，否则你会把 approval-response 回到错误的上下文里。

### 2.2 PermissionEngine 的审批存储模型（当前实现）

核心文件：`package/src/runtime/permission.ts`

- 审批请求的事实来源是 `.ship/approvals/*.json`（pending/approved/rejected）。
- `getPendingApprovals()` 每次会调用 `loadApprovalsFromDisk()` 试图把磁盘上的 pending 合并进内存 Map。
- `waitForApproval()` 是轮询内存 Map（并在缺失时 reload），每秒检查一次状态，默认超时 300 秒。
- `updateApprovalRequest()`/`deleteApprovalRequest()` 会直接写盘/删盘。

### 2.3 Telegram 的执行模型（当前实现）

核心文件：`package/src/integrations/telegram.ts`

**会话隔离（重点）**
- Telegram 的 `getOrCreateSession(userId: number)` 以 `telegram:${userId}` 作为 sessionKey（**按用户**，不是按 chat/group）。
- 在群聊里，`chat.id` 是群 id，而 `from.id` 是用户 id。当前实现用 `from.id` 做 sessionKey，这意味着：
  - 同一群内不同用户会有不同 session（每个用户独立上下文）
  - 但消息发送是发送到群 chatId（因此群里看到的是“多个 session 的输出混在同一群”）

**并发控制**
- 有全局 `MAX_CONCURRENT` 限制，但没有 per-session/per-chat 的互斥锁。
- `pollUpdates()` 会并发处理 `updates.map(processUpdateWithLimit)`，同一 user 在短时间多条消息可能并发进入同一个 `AgentRuntime`（会话内存写入会产生竞态）。

**幂等/去重**
- 依赖 Telegram `getUpdates` 的 `offset = lastUpdateId + 1` 来避免重复。
- 没有把 messageId 做持久化去重；如果进程重启或 offset 丢失，可能重复处理旧消息。

**审批通知**
- `notifyPendingApprovals()` 会读取 pending approvals 并向目标 chat 推送按钮。
- 目标选择逻辑依赖 approval 的 `meta.source`/`meta.userId`：当前写入 `meta.userId` 的值来自 `context.userId`，而 Telegram adapter 在调用 `AgentRuntime.run()` 时把 `userId` 传的是 `chatId`（群 id/私聊 id），这会造成命名混乱但“能工作”（把审批推回到 chatId）。

### 2.4 Feishu 的执行模型（当前实现）

核心文件：`package/src/integrations/feishu.ts`

**会话隔离**
- `getOrCreateSession(chatId, chatType)` 的 sessionKey 是 `${chatType}:${chatId}`（**按 chat**，群聊是群维度）。

**并发与去重**
- 用 `processedMessages: Set<message_id>` 做内存去重（并非持久化）；重启会失效。
- 未显式实现 per-session mutex；但飞书 WS event handler 是否串行取决于 SDK 回调调用方式，不能当作可靠保证。

**审批通知**
- `notifyPendingApprovals()` 只通知 `meta.source === 'feishu'`，并依赖 `knownChats`（只给“见过的 chat”推送）。

### 2.5 Server API 的执行模型（当前实现）

核心文件：`package/src/server/index.ts` + `package/src/runtime/task-executor.ts`

- `/api/execute` 调用 `taskExecutor.executeInstructions(instructions)`，默认不传 sessionId。
- `AgentRuntime.run()` 的 `sessionId` 默认会落到 `'default'`（当 `context.sessionId`/`context.userId` 都缺失）。
- 结论：HTTP API 的所有请求可能共享同一个 `default` session（有严重并发/串扰风险）。

---

## 3. 为什么“平台能力/发什么”应该归 adapter？推荐的边界怎么画？

你提的观点是对的：**adapter 应该决定怎么发**。进一步建议把它规范化成“能力协商 + 渲染意图”。

### 3.1 Core 不该做的事

- 不该决定按钮/卡片/分段规则（Telegram/飞书/Web 差异巨大）
- 不该决定是否 reply 原消息还是直接发群聊（飞书 `p2p`/群的 reply 机制不同）
- 不该用平台特定语法（Telegram Markdown、飞书 JSON content）

### 3.2 Core 应该做的事

- 产出稳定的 **OutboundIntent**（“我要表达什么/我要用户确认什么/我在执行哪一步”）
- 维护执行状态机（running/awaiting-approval/idle）
- 维护幂等与队列（同一 thread 串行）

### 3.3 推荐的 OutboundIntent（示例）

```ts
type OutboundIntent =
  | { type: 'assistant_text'; text: string; correlationId: string }
  | { type: 'progress'; text: string; correlationId: string }
  | { type: 'approval_request'; approvalId: string; summary: string; risk?: string; suggestedReplies: string[] }
  | { type: 'error'; text: string; correlationId: string };
```

adapter 负责把 intent 渲染为：
- Telegram：一条或多条消息 + inline keyboard
- Feishu：reply 或 card
- Web：streaming UI

---

## 4. Adapter 暴露 tool 给 agent：怎么做才不会乱？

你提的“adapter 也可以提供一些 tool 暴露给 agent 调用”是可行的，但建议分两类：

### 4.1 A 类：与平台无关的“工作工具”（推荐放 core）

例如：
- `exec_shell`
- `read_file`/`write_file`
- `memory_upsert`

这些工具的 side effect 发生在 repo/workspace，审批规则统一。

### 4.2 B 类：平台能力工具（adapter 提供）

例如：
- `send_message` / `send_card` / `send_voice`
- `resolve_user_profile`
- `download_attachment`

**注意事项（很重要）**
1) 默认情况下，**agent 不应该用 tool “给当前对话发消息”**，因为 orchestrator/adapter 本来就会把 agent 的最终输出发出去；否则容易重复发送、顺序混乱。
2) 平台 tool 更适合做“旁路能力”，例如：
   - 给别的 thread/channel 发通知
   - 把文件/截图发到某个群
3) 平台 tool 一定要纳入审批策略（至少对跨 thread/channel 的发送做审批）。

### 4.3 推荐的实现方式：每次 run 注入 adapterToolSet

建议 `AgentOrchestrator` 的输入包含：
- `baseTools`（core）
- `adapterTools`（本次请求来自哪个 adapter 就注入哪个）

并且 adapterTools 要带 `capabilities`，让 agent 能做正确选择（例如不支持按钮就别尝试）。

---

## 5. 执行模型（DM/群聊）：怎么跑才稳定？

这里给“强约束版本”（推荐），因为不稳定比功能少更难用。

### 5.1 ThreadId：必须按“会话载体”来定义

建议统一 threadId（不要混用 userId/chatId）：

- Telegram 私聊：`telegram:chat:<chatId>`（私聊的 chatId 通常就是 userId，但别假设）
- Telegram 群聊：`telegram:chat:<groupChatId>`
- Feishu：`feishu:chat:<chatId>`（chatType 可作为 meta 但不建议进 threadId，除非会冲突）

同时保留 `authorId`：
- `authorId = telegram:user:<from.id>` / `feishu:user:<open_id>`

这样你既能：
- 在群里把所有消息放进“群线程”
- 又能知道谁说了什么（用于审批权限/审计/个性化）

### 5.2 串行执行：每个 thread 一个队列（必选）

推荐策略：
- 同一 `threadId` 同时最多 1 个 in-flight run
- 新消息进队列
- 当处于 `awaiting-approval` 时：
  - 非审批回复消息先排队，或提示“我在等你确认上一条操作”

### 5.3 群聊的“多说话人”问题：两种策略（选一种）

**策略 S1（简单 & 推荐）**：群 = 单一共享线程
- 优点：上下文统一，符合“群里大家协作一个 agent”
- 风险：上下文更嘈杂，需要在 Agent.md 里写清楚“只响应 @我/只响应带前缀的消息”

**策略 S2（更隔离）**：群里每个 author 一个子线程
- `threadId = telegram:chat:<groupId>:user:<fromId>`
- 优点：不会串话
- 风险：群内协作信息不共享；审批消息/执行结果在群里可能让人困惑

你现在的 Telegram 实现更接近 S2（按 user session），但输出发到群会造成“多个线程输出混到一个群”这种体验问题。

### 5.4 幂等/去重：不能只靠内存

建议的最小实现：
- ThreadStore 在 append UIMessage 时把 `platform + messageId` 写入一条 meta log
- 新 ingress 进来先查“是否已处理”

这样：
- 进程重启不会重复执行旧消息
- webhook/重试也不会重复执行

---

## 6. 当前 approval 执行模型对“执行模型”的约束是什么？

当前 approval 是“停在中间 → 等用户回复 → 再继续同一上下文”。

这意味着：
- 必须有稳定的 `thread/sessionId`
- 必须保证同一 thread 在 awaiting approval 时不并发跑别的 run
- 必须保证用户回复能路由回“同一 thread 的 pending approvals”

在群聊场景还需要加一条：
- 需要定义“谁有权 approve”：群管理员？发起人？任何人？
  - 当前实现更像“谁都可以 approve”（只要能发消息触发 `handleApprovalReply`）
  - 但 adapter 可以在 core 之前先做权限判断（例如只有管理员的消息才当作 approval-reply）

---

## 7. 建议的落地清单（从当前代码迁移）

1) **统一 threadId 设计**（尤其 Telegram：从 `telegram:${userId}` 改为按 chat/thread）
2) **引入 per-thread mutex/queue**（core 或 adapter 都行，但必须一致）
3) **幂等去重持久化**（至少把 `platform+messageId` 落盘到 `.ship/threads/*`）
4) **把 approval 的“呈现”迁移到 adapter**：
   - core 输出 `approval_request` intent（含建议回复短语）
   - adapter 决定按钮/卡片/文本
5) **平台工具（adapter tools）只做旁路能力**，并纳入审批策略（跨 thread 发送、下载附件等）

---

## 8. 附录：建议新增的文档入口

如果你愿意把这些运行策略写进 `Agent.md`（你更倾向的方式），建议增加几个 section：

- `## Threading Policy`：群聊是否共享线程、是否只响应 @、同一线程串行规则
- `## Approval Policy`：谁能 approve、默认提示格式、可接受的回复短语
- `## Idempotency Policy`：messageId 去重、重试语义

