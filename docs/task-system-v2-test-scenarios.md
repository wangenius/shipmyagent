# Task System v2 测试场景（场景说明 + 期望行为）

本文用于验证当前已落地的 v2 关键能力：
- Agent（Telegram）自动决定 sync/async，并在需要时创建 adhoc Run
- Run 等待审批后继续执行（通过自然语言回复同意/拒绝）
- Run 完成后自动通知到 Telegram（无需任何命令）
- 运行记录落盘、可重启后继续可查、避免重复通知

> 约定：本地数据路径在项目根目录 `.ship/` 下；Run 记录为 `.ship/runs/<runId>.json`；队列 token 在 `.ship/queue/*/`。

---

## 0. 预备检查（一次性）

### 0.1 目录结构存在
- `.ship/runs/` 存在（Run record）
- `.ship/queue/pending/`、`.ship/queue/running/`、`.ship/queue/done/` 存在（queue tokens）
- `.ship/approvals/` 存在（approval snapshots）
- `.ship/.cache/telegram/` 存在（Telegram 缓存）

### 0.2 ship.json 配置
- Telegram 已启用且配置了 `TELEGRAM_BOT_TOKEN`
- LLM 已配置（否则会进入 simulation mode，路由/决策会退化）

---

## 1. 对话触发：短任务应同步完成（sync）

### 场景
用户在 Telegram 对 bot 说一句“很快能完成”的问题，例如：
- “这个仓库里有多少个 package.json？”
- “README 里有哪些章节？”

### 期望行为
- Bot 直接给出答案（不提 runId，也不说后台任务）
- `.ship/runs/` **不一定**有新增（当前实现：sync 仍可能不落盘，这是允许的）
- 不出现“我会在后台处理…”

### 风险点/考虑
- 路由模型输出 JSON 失败时默认 sync（容错）；应仍能正常回答

---

## 2. 对话触发：长任务自动创建 adhoc Run（async）

### 场景
用户发起明显耗时请求，例如：
- “扫描整个仓库，找出所有 TODO 并按优先级给报告”
- “把所有 console.log 替换成 logger，并生成改动清单”

### 期望行为
- Bot 立即回复类似：
  - “我会在后台处理这个请求，完成后把结果发你。runId=run_...（原因：...）”
- `.ship/runs/<runId>.json` 生成且 `status: queued`
- `.ship/queue/pending/<runId>.json` 存在
- 随后 worker 执行并更新 run：
  - `queued -> running -> succeeded|failed`
- 最终 bot 会自动推送结果（无需任何命令），并在 run 文件中写 `notified: true`

### 风险点/考虑
- 结果较长时 Telegram 会分片发送（现有 `splitTelegramMessage`）；要确认不会超 4096 字符导致失败
- Markdown 发送失败时会 fallback 到纯文本

---

## 3. “不提命令”的进度追问（用户自然语言）

### 场景
用户在一个 async run 还没结束时继续追问：
- “现在跑到哪了？”
- “还有多久？”

### 期望行为（当前能力边界）
- 当前实现**没有**提供“实时进度”字段，期望 Agent：
  - 通过读取 `.ship/runs`（或依据上下文）给出合理解释（例如：正在运行/已完成/等待审批）
- 如果你希望更强：需要后续实现“run events/log tail”能力（本场景用于明确差距）

---

## 4. 长任务触发审批：Run 进入 waiting_approval

### 场景
配置 `ship.json` 使 `exec_shell.requiresApproval = true`（或 write_repo 需要审批），然后发起会触发审批的指令，例如：
- “执行 npm test”
- “修改某个文件并保存”

### 期望行为
- run 执行过程中出现 `pendingApproval`：
  - `.ship/runs/<runId>.json` 变为 `status: waiting_approval`
  - run 里记录 `pendingApproval.id`
- bot 会发一条“需要确认”的消息到正确 chat（来源 chat）
- 这条消息不需要命令，用户可直接自然语言回复 “同意/拒绝”

### 风险点/考虑
- approvals 的 meta 必须包含 `runId`，否则后续无法把“恢复执行结果”写回 run record
- 非 Telegram 来源（scheduler）时：需要能路由到一个 chat（见场景 7）

---

## 5. 审批通过后继续跑：自然语言回复 “同意”

### 场景
在场景 4 的 waiting_approval 状态下，用户回复：
- “同意”
- “可以”
- “全部同意”

### 期望行为
- Bot 识别该回复是审批回复（而不是新指令），并继续执行
- 执行完成后：
  - `.ship/runs/<runId>.json` 更新为 `succeeded|failed`
  - `finishedAt` 填写
  - `output.text` 填写
  - `pendingApproval` 清空
  - `notified: true`（因为这次“继续执行”的结果会直接在对话里返回/并写入 run）

### 风险点/考虑
- 群聊时：只有发起人或管理员能做审批（现有逻辑里有校验），非授权人回复“同意”应被拒绝

---

## 6. 审批拒绝后处理：自然语言回复 “拒绝，因为…”

### 场景
waiting_approval 下用户回复：
- “拒绝”
- “不可以，因为会改到生产配置”

### 期望行为
- Bot 解析为拒绝，并停止该审批点继续执行
- run 最终应标记为 `failed`（或未来可扩展为 `canceled`/`rejected`，当前以 failed 为主）
- 结果消息应解释：哪一步被拒绝、后续不会继续

---

## 7. 定时任务（scheduler）触发：审批/结果回到“创建该任务的对话”

### 场景
在 Telegram 里让 Agent 创建/修改一个定时任务（`.ship/tasks/<taskId>.md`），并确保 front matter 写入：
- `source: telegram`
- `chatId: <当前 chatId>`

然后配置 cron 任务到“马上触发”，并让任务可能触发审批或至少能产生结果。

### 期望行为
- scheduler 到点后：
  - 创建 run 并入队
  - run 的 context 会被路由到 `source=telegram` + `userId=<task.chatId>`
- 如果任务触发审批：
  - 审批消息会发到该 chat（无需配置 chat_id，也不依赖 lastActiveChatId）
- 任务完成：
  - 结果会自动通知到该 chat

### 风险点/考虑
- 如果任务 front matter 没有 `source/chatId`，scheduler run 的 context 会退回 scheduler，本版本不会通知到 Telegram（这是合理的“无路由目标”行为）

---

## 8. 重启与恢复：Run 记录可查 + 不重复通知

### 场景
触发一个 async run，等它进入 `running` 或已完成；
然后重启服务进程（`shipmyagent start`）。

### 期望行为
- `.ship/runs/<runId>.json` 仍在
- 已完成 run：
  - 如果 `notified: true`，重启后不会重复发消息
  - 如果之前没来得及通知（`notified: false`），重启后应仍可被通知逻辑补发一次

### 风险点/考虑
- 当前 worker 没有 lease/心跳；如果进程在 `running` 时崩溃，run 可能卡在 `running`（后续可在 v2.1 加入 lease 回收）

---

## 9. 并发与队列竞争：避免重复执行同一个 run

### 场景
（开发/压测）同时启动两个进程指向同一个项目根目录（同一 `.ship/`）。

### 期望行为
- 两个 worker 都会尝试 claim，但 `pending -> running` 的原子 move 应确保只有一个成功
- run 只执行一次

### 风险点/考虑
- 文件系统语义差异（尤其是跨磁盘/网络盘）可能破坏原子性；本地开发一般 OK

---

## 10. 异常文件：run json 损坏/缺字段

### 场景
手工把某个 `.ship/runs/<runId>.json` 写坏（无效 JSON），或删掉 `input.instructions` 等关键字段。

### 期望行为
- notifier/worker 不应整体崩溃（应 catch 并记录 error log）
- 该 run 可被标记失败，或被跳过（当前实现偏“跳过并记录”）

---

## 11. 结果体积：超长输出处理

### 场景
触发一个会输出非常长文本的 run（例如全仓库扫描报告）。

### 期望行为
- Telegram 发送会自动分片
- 单次通知最多截断到约 2500 字符（当前实现），避免刷屏与发送失败
- 完整结果仍保存在 `.ship/runs/<runId>.json`（未来可升级为 artifacts）

---

## 12. LLM 未配置（simulation mode）时的退化

### 场景
故意不设置 LLM key 或 model，让 runtime 进入 simulation mode。

### 期望行为
- `decideExecutionMode` 会返回 `sync`（因为没有 model）
- 系统仍可工作，但不会自动创建 adhoc run（这是合理退化）

---

## 13. 群聊安全性：只有发起人/管理员能审批

### 场景
在 Telegram 群聊里使用 bot（需要 @ 提及触发），发起一个会触发审批的操作；
让非发起人/非管理员回复“同意”。

### 期望行为
- bot 拒绝该用户审批（提示只有发起人/管理员可以）
- run 仍保持 `waiting_approval`

---

## 14. “消息路由一致性”：同一 run 的所有通知回到同一 chat

### 场景
在多个 chat（A/B）都与 bot 对话，然后从 A 触发一个 async run；
期间 lastActiveChatId 可能被 B 更新。

### 期望行为
- run 的 context 在创建时就固定为 A（`context.userId=A`）
- run 完成通知一定回到 A，不受 lastActiveChatId 变化影响

---

## 15. “误判风险”：本应 sync 却被判成 async / 反之

### 场景
给一些边界请求：
- “列出根目录文件” （通常很快）
- “跑一次全量构建并把日志总结” （可能慢）

### 期望行为
- 允许存在误判，但必须满足：
  - async：用户仍会收到结果；不阻塞对话；run 可追踪
  - sync：如果发现需要审批/耗时太长，Agent 应能在后续版本中“中途转 async”（当前未实现，可记录为 v2.1）

---

## 建议的验证顺序（最小回归集）
1) 场景 2（async run + 自动通知）
2) 场景 4/5（waiting_approval + 回复同意 + run 完结）
3) 场景 7（scheduler 路由到 lastActiveChatId）
4) 场景 8（重启不重复通知）
