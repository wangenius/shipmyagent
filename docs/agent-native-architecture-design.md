# ShipMyAgent（package）Agent-Native 架构（重整版）

> 这份文档按你的反馈重写：  
> 1) **只强制 `Agent.md`**（其它文档/目录都应该是可选、可迭代的实现细节）。  
> 2) “session”不是“大模型内部内容”，而是**用户/群聊/平台的对话线程（Thread）**。  
> 3) 跨平台适配以 **AI SDK v6 的 `UIMessage`** 作为基准格式（因为它已经比较成熟，并覆盖 tool/approval/UI 状态）。

---

## 1. 核心结论（先对齐概念）

### 1.1 `Agent.md` 是否够？

够，且应该是唯一必选。

- `Agent.md` = agent 的“宪法/人格/输出规范/工具使用原则/审批偏好/记忆写入规则”的**单一入口**。
- 其它文档（例如 prompt 拆分、memory 文件、routes workflow）都应该是：
  - **可选**：没有也能运行
  - **可从 Agent.md 派生**：例如运行时把 Agent.md 里的某些 section 拆到 `.ship/` 缓存中
  - **可被 Agent 管理**：通过工具写入/更新（并走审批）

### 1.2 “Session / Thread / Memory” 分别是什么？

- **Thread（对话线程）**：平台侧的会话实体（用户私聊、群聊、频道、工单、Web chat room…）。  
  这是你说的 “各个用户、群聊、平台的历史对话内容”。
- **History（线程历史）**：Thread 下的消息序列，基准格式用 `UIMessage[]`。
- **Memory（长期记忆）**：从多个 Thread 提炼出来的“稳定信息”（项目约束/用户偏好/关键决定），不是原始聊天记录。

Thread/History 是“事实记录”；Memory 是“摘要与沉淀”。两者必须分开。

### 1.3 为什么用 AI SDK v6 `UIMessage` 做基准？

因为它天然表达了：
- user/assistant 消息
- tool invocation（含 input/output 状态）
- tool approval（approval-requested 状态/响应）
- 以及 UI 渲染所需的 metadata

并且 AI SDK 提供了把 UIMessage 转成模型消息（ModelMessage）的成熟路径（从而对接 `ToolLoopAgent`）。

---

## 2. vNext 的总体架构（以 UIMessage 为中心）

### 2.1 数据流（跨平台统一）

```
Platform Adapter (Telegram/Feishu/Web/CLI/...) 
  -> Canonical Ingress Event
  -> Thread Resolver (platform + conversation identifiers)
  -> Thread Store: append UIMessage (user)
  -> Agent Orchestrator:
       - load thread UIMessage[]
       - convert -> ModelMessage[]
       - ToolLoopAgent.run (tools + approvals)
       - convert result -> UIMessage deltas (assistant + tool parts)
  -> Thread Store: append UIMessage (assistant/tool)
  -> Postprocess (human-like policy)
  -> Platform Adapter (egress)
```

关键点：
- **Thread Store 只存 UIMessage**（用户可见的聊天与工具 UI 状态），不存“模型内部 prompt 拼接文本”。
- 工具执行、审批、日志是另外的 trace（可以关联到 UIMessage，但不要污染 UIMessage 内容）。

### 2.2 最小可行的核心模块

建议把核心收敛成 4 个服务（平台无关）：

1) `ThreadService`
- 根据平台 event 解析 threadId（私聊/群聊/频道）
- 读写 thread history（UIMessage）

2) `ApprovalService`
- 统一处理 tool approval 的生命周期
- 统一渲染“拟人化的确认文案”
- 统一解析用户的“同意/拒绝/范围授权”回复（确定性优先，LLM 兜底）

3) `MemoryService`
- 从 thread history 提炼长期记忆（markdown 或结构化）
- 召回相关记忆片段，注入到 Agent.md 的运行时上下文中

4) `AgentOrchestrator`
- 只负责把：`UIMessage[] + Agent.md + Memory snippets + ToolSet` 组合起来跑 `ToolLoopAgent`
- 不直接知道 Telegram/Feishu 细节

---

## 3. 平台之间如何“接”：适配器必须被讲清楚

### 3.1 统一的 ThreadId 规则（最重要）

平台适配时，最难的是“这个消息属于哪个线程？”  
建议把 threadId 设计为稳定字符串：

```
threadId = `${platform}:${scopeType}:${scopeId}`

platform: telegram | feishu | web | cli | ...
scopeType: dm | group | channel | room | ticket | ...
scopeId: 平台侧唯一 id（chatId / channelId / roomId / ticketId）
```

例子：
- Telegram 私聊：`telegram:dm:<userId>`
- Telegram 群聊：`telegram:group:<chatId>`
- 飞书群聊：`feishu:group:<chatId>`
- Web：`web:room:<uuid>`

> 这样就不会把“session”误解成模型内部状态；它是平台会话线程。

### 3.2 统一的 Ingress Event（平台 → core）

平台适配器把平台 payload 归一化成：

```ts
type IngressEvent =
  | { type: 'text'; platform; threadId; userId; messageId; text; timestamp; }
  | { type: 'voice'; platform; threadId; userId; messageId; audio; timestamp; }
  | { type: 'approval-reply'; platform; threadId; userId; messageId; text; timestamp; };
```

然后 core 把它转换成 `UIMessage` 并 append 到 thread。

### 3.3 Egress（core → 平台）的输出

core 输出统一为：

```ts
type EgressMessage = {
  threadId: string;
  text?: string;
  // 可选：语音、卡片、按钮（平台能力不同）
  attachments?: any[];
  // 可选：用于平台的 reply/quote
  replyToMessageId?: string;
};
```

平台适配器负责把 `EgressMessage` 映射到平台 SDK（Telegram sendMessage / 飞书消息卡片 / Web SSE）。

### 3.4 审批在跨平台怎么呈现？

原则：**审批的“状态机”在 core**，呈现方式在 adapter。

- core 产出一个“待确认 UI 状态”（仍然是 UIMessage 工具 part 或者一条系统提示 UIMessage）
- adapter 决定：
  - Telegram 用按钮 / 命令
  - 飞书用卡片按钮 / 自然语言
  - Web 用 UI 按钮

但最终回到 core 的都变成 `IngressEvent(type: 'approval-reply')`。

---

## 4. 历史与记忆：不需要“Model Session”，需要“Thread History + Memory”

### 4.1 Thread History（UIMessage 持久化）

存储单位：threadId。  
存储格式：**UIMessage JSONL**（或 JSON array）。

推荐目录：

```
.ship/
  threads/
    <threadId>.jsonl
```

内容只包含 UIMessage + 最小 metadata（timestamp/platform/userId/messageId）。

### 4.2 Memory（长期沉淀）

Memory 不是 thread 记录。它是从多个 thread/任务中提炼出的“稳定事实/偏好/决定”。

推荐默认只做两类（足够好用、且可审计）：

```
.ship/
  memory/
    project.md         # 项目级：约束/关键决定/常用命令/目录结构
    users/
      <userKey>.md     # 用户级：语言偏好/输出偏好/审批偏好
```

写入策略建议写在 `Agent.md`（例如“每 30 轮对话提炼一次”“只记事实与偏好，不记隐私”）。

### 4.3 记忆召回（Agent-native）

分三档迭代：

1) v0（最简单）：直接把 `project.md`/`users/*.md` 的小片段拼进 system instructions
2) v1：做 embedding 索引（可选），按相似度召回片段
3) v2：把 memory 变成可结构化更新的 schema（仍可用 markdown frontmatter）

---

## 5. 工具与确认（AI SDK 原生）

### 5.1 ToolSet 的建议形态

保持 AI SDK v6 原生：
- `ToolLoopAgent`
- `tool({ inputSchema, execute, needsApproval })`

建议的最小工具集（按能力逐步加，不必一开始做大）：
- `exec_shell`（保留）
- `read_file` / `write_file`（可选：用于更强确定性与更可控的权限检查）
- `stt_transcribe` / `tts_speak`（可选：语音）
- `memory_upsert`（可选：写 memory markdown，强制审批）

### 5.2 确认逻辑：确定性优先

审批回复解析建议这样做：

1) 规则解析（高确定性）：
- “同意/可以/approve”
- “拒绝/不行/deny”
- “全部同意/全部拒绝”
- “只同意 X（命令/路径）”
- “在 10 分钟内都同意 git status”

2) 规则解析失败再交给 LLM（兜底）

> 这部分也建议写进 `Agent.md`，保证“拟人化 + 可解释”是一致的。

### 5.3 体验 / 平台 / 接口设计（补充注意事项）

这部分是“踩坑清单”，不写清楚很容易出现：不同平台体验割裂、审批卡住、重复执行、消息乱序、长输出刷屏等问题。

#### 5.3.1 转换契约：`UIMessage[] -> ModelMessage[] -> ToolLoopAgent -> UIMessage delta`

建议把转换收敛到一个模块（只有一处实现），并尽量复用 AI SDK 的转换能力：

- `toModelMessages(uiMessages, injectedContext) -> ModelMessage[]`
- `toUiMessagesDelta(agentResult) -> UIMessage[]`

关键要求：
- Thread store **只存 UIMessage + minimal meta**（timestamp/platform/user/threadId/messageId/correlationId）
- 不落盘“拼好的 prompt 文本”、不落盘“模型私有字段”
- approval 必须可往返（UI 看到 pending → 用户回复 → 生成 `tool-approval-response` → 继续执行）

#### 5.3.2 Thread 执行模型：同一 `threadId` 单线程（强烈建议）

现实场景会有：
- 群聊多人并发发言
- 用户连续多条消息
- tool 执行耗时长（shell/网络/大文件）

建议约束：
- 同一 `threadId` 同时只允许 1 个 in-flight run
- 其它输入进入队列（或合并成一条“你刚刚又补充了…”）

否则会导致：
- UIMessage 顺序不稳定
- tool approval 对不上上下文
- 记忆提炼把不同人的话混在一起

#### 5.3.3 幂等与去重：Ingress 必须携带平台 `messageId`

平台（尤其 webhook / long polling）都会重试或重复投递，必须在 core 层做幂等：
- `platform + messageId` 做唯一键
- 已处理的 ingress 直接丢弃或返回 cached response

否则会出现：
- 重复执行命令
- 重复写入 memory
- 重复发消息（体验很差）

#### 5.3.4 能力协商（capabilities）：不要假设所有平台都支持按钮/卡片/语音

建议 adapter 明确声明能力：

```ts
type AdapterCapabilities = {
  supportsButtons: boolean;
  supportsRichCards: boolean;
  supportsVoice: boolean;
  supportsThreadedReplies: boolean;
  maxMessageChars: number;
};
```

core 根据能力决定：
- 审批用按钮还是自然语言指令
- 长文如何分段/分页
- 是否发语音附件

#### 5.3.5 拟人化不仅是语气，更是“对话行为”

建议把以下行为写进 `Agent.md`（而不是散落在实现里）：
- 信息不足先问 1~3 个关键问题，再行动
- 默认先小步探索（`ls/rg/cat`），再提议高风险动作
- 工具输出不 dump：只给“结论 + 证据摘要 + 下一步选项”
- 失败时承认失败，解释原因，给替代方案

#### 5.3.6 长输出与刷屏：默认摘要 + “继续/展开”

统一做几条策略（core 层实现，adapter 只负责渲染）：
- 超长消息自动分页（“继续/下一页”）
- 默认只输出摘要；用户说“发完整输出”才给原文
- tool stdout/stderr 默认截断 + 指向日志/附件

---

## 6. 语音输入（STT）定位：属于平台能力，但要走同一条链路

语音的关键不是“它是不是 session”，而是它最终要进入 Thread history（UIMessage）。

建议：
- adapter 收到 voice/audio → 产生 `IngressEvent(type:'voice')`
- core 调用 `stt_transcribe` 工具得到 text
- 把转写后的 text 作为 user UIMessage append（可把原音频作为附件 metadata）

TTS 同理：assistant text → `tts_speak`（可选）→ adapter 发语音附件。

---

## 7. 最终建议的项目结构（以“只必选 Agent.md”为前提）

### 7.1 项目根目录（用户项目）

```
your-project/
  Agent.md                 # 唯一必选：宪法/人格/策略/记忆规则
  ship.json                # Runtime 配置（provider/permissions/integrations）
  .ship/
    approvals/             # 审批请求（现有）
    logs/                  # 审计日志（现有）
    tasks/                 # 定时任务 md（现有）
    threads/               # UIMessage 历史（新增建议）
    memory/                # 长期记忆（可选新增）
```

> `threads/` 与 `memory/` 都应该是“没有也能跑”的可选增强；缺失时自动创建。

### 7.2 package 代码结构（开发者视角）

建议以后新增一个核心目录（不影响现有入口的前提下逐步迁移）：

```
package/src/
  core/
    thread/                # ThreadService + 存储
    approvals/             # ApprovalService + parser + renderer
    memory/                # MemoryService（markdown + 可选索引）
    orchestrator/          # ToolLoopAgent + UIMessage<->ModelMessage
    postprocess/           # 拟人化输出净化（平台无关）
  adapters/
    telegram/
    feishu/
    web/
  runtime/                 # 逐步收敛/迁移到 core（保留兼容期）
```

---

## 8. 迁移/迭代顺序（最短路径）

1) 先把“平台共性”抽出来：ThreadId 规则 + Ingress/Egress 类型 + Postprocess（把 sanitize 从 adapters 下沉）
2) ThreadStore：把每条用户输入/assistant 输出都 append 为 UIMessage（落盘）
3) ApprovalService：规则解析优先 + 统一渲染确认文案（UI/按钮交给 adapter）
4) MemoryService：先做 markdown project.md/user.md（无 embedding 也能用）

---

## 9. 安全提醒（顺带）

- `ship.json` 的 `apiKey` 不建议明文；推荐 `${ENV_VAR}`。
- `exec_shell` 如果 `shell: true`，建议对含 `&&`/`|`/`;` 的命令强制审批（写进 Agent.md 的策略）。
