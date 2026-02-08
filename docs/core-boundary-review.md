# Core 边界梳理与重构建议（agent/ + chat/）

> 状态：已落地（`agent/` + `chat/` 已合并到 `core/`）  
> 目标读者：ShipMyAgent 维护者  
> 关键约束：不考虑向后兼容；最简 + 最佳实践

---

## 1. 现状：为什么你会觉得边界不清

现在的真实依赖关系（按“谁需要谁”）大致是：

- `server/*` / `adapters/*`（入口层）
  - 依赖：`chat/runtime/*`（调度 + 落盘 + 回包兜底）
  - 依赖：`agent/context/*`（LLM tool-loop 执行引擎）
- `chat/*`（调度 + store + egress）
  - 依赖：`agent/*`（调用 Agent.run）
- `agent/*`（prompt + tools + run）
  - 依赖：`chat/history/store.ts`（历史/compact）
  - 依赖：`chat/context/request-context.ts`（request scoped 元信息）
  - 依赖：`chat/egress/*`（chat_send / dispatcher / idempotency）

也就是说：**agent 与 chat 是互相依赖的**。这在“模块”意义上很容易造成两个问题：

1) **命名误导**：`agent/` 看起来像“独立引擎”，但实际上它需要 chat 的 store 与 egress 才能完整工作。  
2) **层次不稳**：`chat/` 看起来像“上层编排”，但它又直接 import agent 内部的一些 helper/工厂时，会变成反向依赖。

因此，你的直觉是对的：当前结构更像是一个“核心系统（Core）”，只是被拆成了 `agent/` 与 `chat/` 两个目录。

---

## 2. 我认为应该怎么定边界（核心原则）

### 2.1 把“能跑一次对话”的最小闭包叫 Core

要让系统跑通一轮对话，必需的能力其实是：

- Context（UIMessage[] history + compact）
- Tools orchestration（tool-call / tool-result 一致性）
- Egress（chat_send 的投递与幂等）
- Scheduler（同 chatKey 串行、跨 chatKey 并发）
- Skills（动态约束注入 + 持久化策略）

这些合在一起就是你提到的：`Session + TurnContext + ContextManager + tools orchestration`。

所以更合理的命名不是“agent vs chat”，而是 **Core**，并把 `agent/chat` 当作 Core 的子域（或干脆拆成更直接的子模块：history/tools/egress/runtime）。

### 2.2 入口层（server/adapters/commands）只能“调用 core”，不要反向污染 core

Core 内部不应该依赖：

- `server/*`（HTTP、路由、进程级单例）
- `adapters/*`（Telegram/API 等平台差异）
- `commands/*`（CLI 命令行入口）

否则会出现隐式初始化时序、难测试、难复用的问题。

---

## 3. 已做的改动（边界收敛的两个低风险点）

这次我已经先做了两处“明显不该在 agent/ 里”的东西迁移：

1) **“用户可见回复文本”的提取逻辑**迁移到了 egress  
   - 新位置：`package/src/core/egress/user-visible-text.ts`  
   - 原因：这是 `chat_send` 语义，属于 egress，而不是 Agent 引擎能力  

2) **`createModel` 从 agent/context 抽离为独立 LLM 层**  
   - 新位置：`package/src/llm/create-model.ts`  
   - 原因：模型工厂是 Core 公共能力，不应该通过 `server/ShipRuntimeContext` 这种单例拿依赖（隐式初始化）  

这两点的效果是：减少了 `chat -> agent` 的“反向依赖味道”，并让 LLM 创建更靠近“基础设施层”。

---

## 4. “直接合并成 core/” 是否更好？

结论：**是的，更好**，而且能立刻解决“边界不清”的主要感知问题（目录结构与真实依赖一致）。

但要注意：仅把目录改名为 `core/` 只能解决“命名与组织”；真正的工程收益来自“层次清晰”，也就是：

- Core 不依赖 server/adapters/commands
- 入口层通过依赖注入把必要的能力（logger/mcpManager/dispatcher）交给 core


---

## 5. 迁移策略（已执行）

### 方案 A：一步到位（目录迁移）✅ 已做

把 `package/src/agent/*` 与 `package/src/chat/*` 迁移到：

（已扁平化为 `package/src/core/*`：`context/egress/history/runtime/tools/skills/mcp/memory`）

并全局替换 import 路径。

优点：
- 快速、直观：从结构上承认“它们都是 core”
- 不需要引入额外抽象

缺点：
- 改动面大（纯路径变更），需要一次性 `typecheck` 兜底

### 方案 B：继续做“层次收敛”（下一步）

先把以下“明显属于 core 基础设施”的点收敛出来：

- LLM 模型工厂（已做）
- egress helpers（已做）
- 下一步可以做：
  - toolset 组装不再直接读取 `ShipRuntimeContext`（改为由 runtime/入口注入）
  - history store / request context 放到更中立的 core 子域（避免 agent/chat 互相 import）

等依赖方向清晰后，再迁移目录到 `core/`。

优点：
- 每步改动小、风险低

缺点：
- 需要多几次迭代才能“看起来像 core”

---

## 6. 我建议你怎么选

你当前的偏好是“不考虑向后兼容 + 最简”，所以我建议：

- **先选方案 A（一步到位搬目录）**：把 `agent/` 与 `chat/` 放进 `core/`，把“命名与现实”对齐
- 然后再按需要做方案 B 的“层次收敛”（把 server 单例依赖从 core 里逐步拔掉）

如果你确认要走方案 A，我可以下一步直接开始做目录迁移 + import 重写，并跑 `typecheck` 确认功能一致。
