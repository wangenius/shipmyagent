# Chat 消息队列与多平台会话路由：重设计方案（Draft）

> 目标读者：ShipMyAgent 的维护者（开发文档）。  
> 范围：Telegram 私聊/群聊（含 topic）、QQ（官方 bot gateway），以及未来可扩展的平台（Feishu 等）。

## 0. 现状速记（以代码为准）

当前架构的关键事实：

- **全局单队列串行**：所有平台、所有会话共用一个 `QueryQueue`，严格一次只处理一条消息（FIFO）。  
  参考：`package/src/chat/query-queue.ts`、`package/src/adapters/base-chat-adapter.ts`
- **一个 chatKey 一个 Agent 实例**：每个会话隔离上下文，但仍被全局队列串行调度。  
  参考：`package/src/adapters/base-chat-adapter.ts`
- **忙碌 ACK**：队列忙时会主动回一条「已收到，稍后回复」，并显示“队列第 N 条”（N 是全局位置）。  
  参考：`package/src/chat/query-queue.ts`
- **工具严格回包 + 兜底发送**：模型应调用 `chat_send`；如果没调用，则用 `sendFinalOutputIfNeeded` 发一次最终 output。  
  参考：`package/src/agent/tools/builtin/chat.ts`、`package/src/chat/final-output.ts`
- **幂等**：
  - 入站幂等：Telegram 做了持久化去重（`tryClaimChatIngressMessage`），QQ 目前未见同等机制。  
    参考：`package/src/chat/idempotency.ts`、`package/src/adapters/telegram/bot.ts`
  - 出站幂等：`chat_send` 基于 inbound `messageId` 做持久化去重，避免 tool-loop 重复发送。  
    参考：`package/src/chat/egress-idempotency.ts`、`package/src/agent/tools/builtin/chat.ts`
- **会话键**：
  - Telegram：`telegram-chat-<chatId>` 或 `telegram-chat-<chatId>-topic-<threadId>`  
  - QQ：`qq-<chatType>-<chatId>`

## 1. 为什么要重设计（问题清单）

### 1.1 性能与公平性

- **跨会话互相阻塞**：任意一个会话的长任务会拖住所有人（包括不相关平台）。这在群聊场景会非常明显。
- **缺少公平调度**：一个“高频对话”会持续把队列填满，低频会话的体验不可预测。
- **全局队列位置不友好**：忙碌 ACK 的“第 N 条”是全局位置，既不准确（对用户不可解释），也可能泄露系统负载。

### 1.2 可靠性与一致性

- **入站幂等不一致**：Telegram 有持久化去重，QQ 没有 => 同一条消息重复触发的风险在不同平台不一致。
- **回复依赖平台特性差异**：QQ 被动回复需要 `chatType + messageId`，如果上下文/联系人数据缺失会导致“能处理但发不出去”。

### 1.3 可扩展性与可观测性

- 当前队列是内存数组 + 单 while loop，缺少：
  - per-chat/per-channel 的排队长度与延迟指标
  - 可配置的并发（例如：允许不同 chatKey 并行，但同一 chatKey 串行）
  - 更清晰的失败策略（超时、重试、降级）

## 2. 重设计目标（明确取舍）

### 2.1 目标

- **同一 chatKey 串行**（保持上下文一致，避免并发写历史/并发工具调用的竞态）
- **不同 chatKey 可并行**（提升整体吞吐，避免跨会话互相阻塞）
- **公平调度**（避免单一会话饿死其他会话）
- **统一的入站/出站幂等策略**（跨平台一致）
- **用户可理解的 ACK**（只描述“本会话”的状态，不暴露全局负载）
- **可观测**：提供最基本的队列指标、traceId/requestId 关联

### 2.2 非目标

- 不做分布式队列/数据库引入（仍坚持 local-first）
- 不追求强一致“恰好一次”（文件幂等 + best-effort，优先“不丢消息”）

## 3. 新方案概览：Lane Scheduler（按会话分 lane）

核心思想：把“队列”从一个全局数组，升级为 **按 chatKey 分 lane 的队列 + 全局调度器**。

- **Lane（车道）**：每个 `chatKey` 一条 lane，lane 内严格 FIFO 串行执行。
- **Scheduler（调度器）**：从多个 lane 中挑选下一个任务执行，支持：
  - 全局最大并发（例如 `maxConcurrency = 4`）
  - 每个 channel 的并发上限/速率限制（例如 Telegram 2、QQ 1）
  - 公平性策略（推荐：Round-robin 或 Deficit Round-robin）

### 3.1 数据模型（建议）

统一入站消息结构（便于跨平台一致处理）：

```ts
type ChatEnvelope = {
  // 路由
  channel: "telegram" | "qq" | "feishu";
  chatId: string;
  chatKey: string;
  chatType?: string;
  messageThreadId?: number;

  // 幂等与可追溯
  messageId?: string;       // 平台稳定的入站消息 id（强烈建议每个平台都提供）
  ingressId: string;        // 统一生成的入站唯一键（见 4.2）
  receivedAt: number;

  // actor
  userId?: string;
  username?: string;

  // 内容
  text: string;
  attachments?: unknown[];
  meta?: Record<string, unknown>;
};
```

> 说明：`ingressId` 统一用来做入站幂等，不再“看平台有没有 messageId 才能幂等”。

## 4. 关键设计点（强建议落地）

### 4.1 并发模型：同 chatKey 串行，不同 chatKey 并行

建议约束：

- `chatKey` 是会话隔离的最小单位（DM、群、topic/thread）。
- **任何会话级副作用**（写 history、写 memory、工具调用）都应在 lane 内串行。
- scheduler 只做“lane 之间”的并发与公平，不改变 lane 内顺序。

推荐配置项（ship.json 或 env）：

在 `ship.json` 中配置：

- `context.chatQueue.maxConcurrency`：全局最大并行任务数（默认 2）
- `context.chatQueue.enableCorrectionMerge`：是否启用“快速补充/纠正”（默认 true）
- `context.chatQueue.correctionMaxRounds`：每次请求最多注入轮数（默认 2）
- `context.chatQueue.correctionMaxMergedMessages`：每轮最多合并条数（默认 5）
- `context.chatQueue.correctionMaxChars`：每轮最大注入字符数（默认 3000）

### 4.2 入站幂等：统一 ingressId（跨平台一致）

现状的问题是“部分平台做了入站去重，部分没有”。建议改成统一规则：

**ingressId 构造优先级（从强到弱）**：

1. `channel + chatKey + messageId`（平台稳定 messageId 存在时）
2. `channel + chatKey + (timestamp bucket) + hash(text + actor + attachments)`（兜底）

并持久化 `tryClaim`：

- 存储：`.ship/.cache/ingress/<channel>/<encode(chatKey)>/<encode(ingressId)>.json`
- 原子创建（`wx`）抢占成功才进入队列
- 失败策略：任何 I/O 异常都允许继续（宁可重复，也不丢消息）

> 关键点：QQ 也必须实现入站幂等（跟 Telegram 同级），否则“重复触发”无法从框架层保证。

### 4.3 出站幂等：从“messageId 单维度”升级为“replyKey”

当前 `chat_send` 以 inbound `messageId` 做去重在大多数情况下很好，但在以下场景会有缺口：

- 群聊 thread/topic：同一 messageId 的上下文可能需要多段回复（例如分段输出/继续输出）
- “续问/继续”型消息：messageId 不同，但回复应当是新的（这里没问题）

建议把出站去重 key 定义为：

`replyKey = channel + chatId + (inbound messageId 或 ingressId) + toolName(chat_send) + optionalReplySlot`

其中 `optionalReplySlot` 默认为 `0`，但允许：

- 工具参数显式声明 `slot`（比如需要多段回复时）
- 或框架内部把“同一次 agent.run 的多个 chat_send”映射为不同 slot

### 4.4 用户 ACK：只反馈本会话，不暴露全局位置

建议把 ACK 改为：

- “已收到，正在排队（本会话第 N 条）”
  - N 是 **同 chatKey lane 的排队位置**
  - 不再输出全局队列位置
- 如果 lane 为空但全局并发已满：提示“正在处理其它会话任务，稍后开始”

并提供“可选”的更强交互（可后续做）：

- Telegram：发送 `typing...` 或“处理中”的状态（注意频率限制）
- QQ：根据平台能力决定是否发送状态（不支持就仅 ACK）

### 4.5 失败策略：超时、重试与降级

建议最小可行策略：

- `agent.run` 超时（例如 3~10 分钟）：
  - 标记该 envelope 失败
  - 给用户回一条可理解错误（并提示如何重试）
- 工具调用失败（例如发送失败）：
  - 出站 claim 释放（允许重试）
  - 记录结构化日志（包含 ingressId/replyKey）

### 4.6 可观测性：必须有的指标

建议至少暴露这些指标（日志 + 可选 /health 扩展接口）：

- `queue.lanes`：lane 数量
- `queue.pending_total`：全局待处理数
- `queue.pending_by_channel`：按 channel 聚合
- `queue.pending_by_lane_topK`：最拥堵的 N 个 lane
- `queue.oldest_age_ms`：最老任务等待时间
- `queue.running`：当前运行中的任务数

日志关联建议字段：

- `ingressId`、`chatKey`、`channel`、`messageId`、`requestId`

## 5. 推荐的模块拆分（便于实现与测试）

> 这是“实现建议”，不是强制，但按这个拆会最清晰。

- `chat/ingress/`  
  - `normalize.ts`：平台事件 -> `ChatEnvelope`
  - `idempotency.ts`：`tryClaimIngress(ingressId)`
- `chat/scheduler/`  
  - `lane.ts`：lane 队列结构
  - `scheduler.ts`：并发 + 公平调度
  - `ack.ts`：ACK 策略（按 lane）
- `chat/egress/`  
  - `dispatcher.ts`（现有可复用）
  - `idempotency.ts`（replyKey 模型）
- `chat/transcript/`  
  - `store.ts`（现有 ChatStore）
  - `contacts.ts`（已移除：改为按 chatKey 投递）

## 6. 行为示例（你提到的 3 个场景）

### 6.1 Telegram 私聊

- `chatKey = telegram-chat-<userChatId>`
- 同一私聊消息按顺序执行；不同私聊可并行。

### 6.2 Telegram 群聊

推荐策略（保持“机器人不吵”）：

- 仅处理：
  - @ 提及机器人
  - 回复机器人消息
  - 或在“follow-up window”内的同一发起人短追问（现有逻辑可继续复用）
- `chatKey` 以 `chatId` + `messageThreadId`（topic）区分，topic 内串行，topic 之间可并行。

### 6.3 QQ（官方 bot）

- `chatKey = qq-<chatType>-<chatId>`
- 强制要求入站必须带 `messageId`（或兜底生成 ingressId）用于：
  - 入站幂等（防重复触发）
  - 出站被动回复去重与可靠发送

## 7. 迁移策略（最小改动路径）

建议按顺序落地（每一步都可独立上线）：

1. **补齐 QQ 入站幂等**：把 Telegram 的 `tryClaimChatIngressMessage` 模式推广到 QQ。
2. **替换全局队列为 Lane Scheduler**：保持 `enqueueMessage()` API 不变，但内部从“全局数组”切到“按 chatKey lane”。
3. **ACK 改为 per-lane 位置**：不暴露全局 N。
4. **补指标**：至少在日志里输出队列状态。
5. （可选）出站去重升级 replyKey：解决多段回复/分片输出的边界问题。

## 8. 风险与注意事项（必须提前确认）

- 并发增加后，资源压力会上升（LLM 并发、文件 I/O、网络发送），必须有 **全局并发上限**。
- 同 chatKey 串行是底线：否则会出现历史写入乱序、工具调用竞态、以及“同一会话回复错乱”。
- ACK/typing 等互动要严格限流，否则会触发平台限频或被用户认为“刷屏”。

---

## 附：一句话结论

把“全局单队列串行”升级为“按 chatKey 分 lane + 全局调度器”，并统一 ingress/egress 幂等与 ACK 语义，是目前最小复杂度下，能显著改善 Telegram 私聊/群聊 + QQ 共存体验的方案。
