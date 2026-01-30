# Chat / Session / History / Memory 概念澄清（统一口径）

目标：把概念讲清楚，避免“session=模型状态”的误解；并给出跨入口（Telegram/飞书/Web/HTTP/CLI…）一致的持久化键与落盘形态。

---

## 1) 四个词分别指什么？

### 1.1 `Chat`（建议用这个词替代 Thread/Session）

`Chat` = 平台侧“对话承载体”，是 **历史记录与幂等去重** 的最小归档单位。

典型例子：
- Telegram 私聊：一个 user 的私聊对话
- Telegram 群聊：一个 group chat
- 飞书群聊：一个 chat
- Web：一个 room
- HTTP：一个外部系统的“会话 id”（如果调用方传入）

一句话：**Chat 是“用户看到的聊天窗口/房间/群/频道”**。

> 你说的 “thread 和 session 是一个意思，改成 chat 就好了”——是的：对外统一叫 `Chat` 最清晰。

---

### 1.2 `Session`（建议收敛为运行时术语，尽量不暴露）

`Session` = 运行时进程里的 **短期执行上下文/句柄**（例如内存缓存、单线程队列、某个 AgentRuntime 实例）。

它的特性：
- **可重建**：进程重启后可以从持久化 History 恢复
- **不作为事实来源**：不应承载“唯一历史”

一句话：**Session 是实现细节；Chat 是业务概念**。

---

### 1.3 `History`（聊天历史）

`History` = 某个 Chat 下按时间追加的消息序列（append-only log）。

它的原则：
- **跨入口统一**：无论从 Telegram/飞书/Web/HTTP/CLI 进入，都写入同一份 History（只要它们映射到同一个 Chat）
- **可审计**：能回放“当时发生了什么”
- **可恢复**：进程重启后可从 History 恢复对话上下文（以及待审批状态）

一句话：**History 是“事实记录”**。

---

### 1.4 `Memory`（长期记忆）

`Memory` = 从 History（甚至多个 Chat）中提炼出的 **稳定信息**（偏好、约束、重要决定、常用命令、项目规则等）。

它的原则：
- **不是原始聊天记录**：不与 History 混存
- **可解释、可编辑**：最好用 Markdown 或结构化（frontmatter + markdown）保存，写入应可审计/可审批
- **可召回**：根据当前对话选择性注入到 Agent.md 的运行时上下文

一句话：**Memory 是“摘要与沉淀”，不是“聊天回放”**。

---

## 2) 一个实用的统一键：Channel + ChatId + UserId

你提出的键：`渠道 + chat_id + user_id`，我建议拆成两层来理解（否则群聊会有两种合理口径）：

### 2.1 `ChatKey`（对话承载体）

用于聚合一个“窗口/群/房间”的公共上下文：

```
chatKey = `${channel}:${chat_id}`
```

例子：
- `telegram:chat:123456789`（私聊 chat_id 也会是一个 chat）
- `telegram:chat:-100xxxxxxx`（群）
- `feishu:chat:oc_xxx`
- `web:room:uuid`

**推荐：History 以 chatKey 为主存储**（更符合“群里大家协作一个 agent”的直觉）。

> 你的最新决策：**群聊就是一个 Chat**，不需要按 user 拆分 history；但每条消息必须记录 `user_id`（作者），用于审计/权限/审批。

---

### 2.2 `ActorKey`（发言者/身份维度）

用于权限、审批、个性化、风控（“谁说的/谁能批/谁是发起人/谁是管理员”）：

```
actorKey = `${channel}:${chat_id}:${user_id}`
```

例子：
- `telegram:chat:-100xxxxxxx:user:99887766`
- `feishu:chat:oc_xxx:user:ou_xxx`

**建议：ActorKey 作为元数据落在每条 message 上**，而不是强制把 History 也拆成每人一份。

---

### 2.3 结论：不要用 channel+chat_id+user_id 分桶做 History

在你的口径下：
- 群聊 = 一个 chatKey（共享 History）
- userId 只作为每条记录的字段（谁说的）

因此 **不需要** 把 History 按 `channel+chat_id+user_id` 拆分存储。

---

## 3) History 持久化应该长什么样？

你的要求是：“简单，push 追加就行”。推荐两种都很简单：

### 3.1 JSONL（推荐默认）

- 追加写入性能好
- 一行一条记录，天然 append-only
- 方便做去重（按 messageId）与回放

目录建议：

```
.ship/
  chats/
    <chatKey>.jsonl
```

每条记录最少包含：
- `channel`
- `chat_id`
- `user_id`（作者）
- `message_id`（用于幂等去重）
- `ts`
- `role`（user/assistant/tool/system）
- `content`（建议用 ai-sdk v6 的 UIMessage 结构，或至少能无损映射）

---

### 3.2 Markdown（可选）

Markdown 更适合“人看”，但做幂等/工具状态/结构化会更麻烦。

比较好的折衷：
- History 用 JSONL
- Memory/摘要用 Markdown

---

## 4) 关键策略：群聊到底怎么记？

你的策略已经定了：**群聊 = 一个 Chat（shared）**。

### 4.1 `group_history_mode = shared`（固定）

- 群 = 一个 chatKey
- 每条消息带 actorKey（user_id）
- 审批：用 actorKey + 管理员判断谁能批

这对应“群协作一个 agent”的体验。

---

### 4.2 `group_history_mode = per_user`（不采用）

不采用该策略，以免破坏群协作上下文一致性。

---

## 5) 你提的“跨交互端口统一”如何落地（不改权限前提下）

从任何入口进来，都先做同一件事：

1) 解析 `channel/chat_id/user_id/message_id`
2) 计算 `chatKey`（以及可选的 actorKey）
3) 读出 `History(chatKey)`（用于恢复/上下文）
4) 追加写入一条“用户消息记录”
5) 运行 agent 得到输出
6) 追加写入“assistant/tool/approval 状态记录”

这样就满足你说的：
- “下次增加新消息直接 push”
- “不论从什么交互端口都能对齐到同一份历史”

---

## 6) 建议的命名收敛（结论）

- 对外：统一用 `Chat`（不要再让 Thread/Session 混用）
- 对内：
  - `ChatKey` = channel + chat_id（默认建议）
  - `ActorKey` = channel + chat_id + user_id（用于权限/审批/个性化）
- `History`：Chat 下的 append-only 事实记录
- `Memory`：从 History 提炼出的长期沉淀（建议 Markdown）
