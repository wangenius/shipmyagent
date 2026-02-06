# 跨轮 Context（显式切换）：`chat_context_new` / `chat_context_load`

> 目标读者：ShipMyAgent 维护者（开发文档）。  
> 设计取向：**不做自动 judge**，不引入复杂状态机；改为“工具驱动”的显式上下文切换与恢复。

---

## 1. 关键定义（不改变 chat 概念）

- **chat / transcript**：平台侧的用户对话历史（审计账本），仍落在 `.ship/chat/<encodedChatKey>/conversations/history.jsonl`，不变。
- **context（本机制）**：Agent 的“工作上下文快照”（只保留 user/assistant 关键消息），落在 `.ship/chat/<encodedChatKey>/contexts/`。

> 关键点（中文）：context 不是长期记忆，也不替代 transcript；它是“当你觉得背景太乱时，显式开新上下文”的工具化能力。

---

## 2. 用户体验（你要的方案）

### 2.1 创建新上下文：`chat_context_new`

当模型判断：
- 背景过多/过乱
- 与当前用户消息关系不大
- 容易误导回答

则调用：

- `chat_context_new({ title?, reason? })`

行为：
1) 以“**最后一条 assistant 消息**”作为 checkpoint，把旧的 active context 落盘为快照（archive）。
2) 清空本次 run 的 in-flight messages（只保留 system + 当前 user），让后续 step 在干净上下文继续。

### 2.2 恢复旧上下文：`chat_context_load`

当模型需要回忆某个旧上下文（例如用户说“回到刚才那个方案/继续上个上下文”），调用：

- `chat_context_load({ query, mode?, contextId? })`

行为：
- 根据 `query` 在归档快照里做 best-effort 文本检索（或直接用 `contextId` 指定）。
- 把匹配快照以“**一条 assistant message（仅供参考）**”注入到当前上下文（类似 `chat_load_history` 的注入方式）。

辅助：
- `chat_context_list()`：列出可用快照的 `contextId/标题/预览`。

---

## 3. 落盘结构（实现）

```
.ship/chat/<encodedChatKey>/
  conversations/
    history.jsonl                 # 现有 transcript（不动）
  contexts/
    active.json                   # 当前活跃 context（最多 1 份）
    index.json                    # 归档索引（轻量）
    archive/
      <contextId>.json            # 归档 context（完成后落盘）
```

### 3.1 `active.json`（最小模型）

```jsonc
{
  "v": 1,
  "contextId": "c_20260205_abcd",
  "status": "active",
  "createdAt": 1738713600000,
  "updatedAt": 1738713900000,
  "title": "修复跨轮 context 保持（进行中）",
  "turns": [
    { "v": 1, "ts": 1738713600000, "role": "user", "text": "..." },
    { "v": 1, "ts": 1738713610000, "role": "assistant", "text": "..." }
  ],
  "meta": {
    "lastUserTextPreview": "请把 config 发我…",
    "lastRequestId": "..."
  }
}
```

约束：
- `turns` 必须严格预算（`maxTurns/maxChars`），避免无限膨胀。
- 不要把大段 tool 原始输出塞进 turns；只保留“用户可见输出 + 关键结论”。

### 3.2 `archive/<contextId>.json`

与 active 同结构，但 `status=archived`，并可附加：

```jsonc
{
  "archivedAt": 1738713999000,
  "archiveReason": "completed",
  "summary": "…（可选，短摘要，用于快速唤起）"
}
```

### 3.3 `index.json`

用于 tool 列表/检索：

```jsonc
{
  "v": 1,
  "items": [
    {
      "contextId": "c_20260205_abcd",
      "title": "修复跨轮 context 保持",
      "createdAt": 1738713600000,
      "archivedAt": 1738713999000,
      "messageCount": 22,
      "summaryPreview": "已完成：…"
    }
  ]
}
```

---

## 4. Tool：唤起 archived contexts

建议新增 builtin tools：

1) `chat_context_list({ limit? })`
- 返回 `contextId/title/createdAt/archivedAt/summaryPreview`

2) `chat_context_recall({ contextId, mode })`
- `mode: "summary" | "recent" | "full"`
- 行为：把归档 context 作为“参考信息”注入到当前 run（合并为一条 assistant message）

注入模板（建议）：

```
以下是历史归档 context（仅供参考，可能与当前问题不一致）：
- contextId: ...
- mode: summary/recent/full
...内容...
```

3) `chat_context_clear_active()`
- 手动清空当前 active context（应对误判/污染）

> 关键点（中文）：唤起必须标注“仅供参考”，避免旧上下文覆盖当前指令。

---

## 5. 配置项（ship.json，建议）

```jsonc
{
  "context": {
    "contexts": {
      "enabled": true,
      "activeMaxMessages": 80,
      "activeMaxChars": 24000,
      "enabled": true,
      "maxTurns": 120,
      "maxChars": 48000,
      "searchTextMaxChars": 12000
    }
  }
}
```

说明：
- 默认无需配置，只有在你希望限制快照大小或关闭功能时才配置。

---

## 6. 与现有代码的最小对接点（实现提示）

> 本文是机制设计，落地时尽量复用当前 “transcript 合并为一条 assistant message” 的注入习惯，保持 token 可控。

推荐落点：
- 在 `package/src/agent/context/agent.ts` 构造 messages 前：
  - 读取 `.ship/chat/<chatKey>/contexts/active.json`（若存在）
  - 判定 `shouldReuseContext`
  - 选择复用或走现有逻辑
- 在 `Agent.run` 结束后：
  - 更新 activeContext（追加本轮 user/assistant 关键消息）
  - 调用 completion judge（heuristic/AI）
  - archive 或 keep
- tools 放在 `package/src/agent/tools/builtin/`，复用现有 `prepareAssistantMessageOnce` 注入机制

---

## 7. 关键取舍总结

- 不改变 chat/transcript 概念：chatKey 的 platform 历史仍是事实账本。
- 引入 contexts/ 作为“工作上下文快照”：由工具显式创建新上下文与恢复旧上下文。
- 不做自动 judge：避免引入额外延迟与复杂状态机。
