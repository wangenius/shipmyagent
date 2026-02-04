# 关键风险点与改进建议（按优先级）

更新时间：2026-02-04

本文列出当前实现中最值得关注的不一致点/风险点，并给出可落地的改进建议。

## P0：API 模式与 tool-strict 输出规则冲突

现状：
- DefaultPrompt 已改为“优先 `chat_send`，无 chat 上下文则允许直接输出文本”：`package/src/core/agent/prompt.ts:1`
- `/api/execute` 已注入 `chatKey`（但不提供 channel dispatcher 回发）：`package/src/server/index.ts:1`
- dispatcher registry 不支持 `"api"`（`ChatDispatchChannel` 仅 `telegram|feishu|qq`）：`package/src/core/chat/dispatcher.ts:1`

影响：
- API 调用链中 `chat_send` 仍可能失败（无 channel/chatId），但不会阻塞最终文本输出

建议（建议至少做其中一项）：
1) **让 API 请求也进入 ChatRequestContext**
   - 在 `/api/execute` 执行前 `withChatRequestContext({ channel: "api", chatId, chatKey, ... }, () => runtime.run(...))`
2) **让 prompt 在非 chat 场景放宽约束**
   - 若不存在 `chatRequestContext`（或没有 channel/chatId），则 prompt 允许直接输出最终文本，不强制 `chat_send`
3) **扩展 dispatcher 支持 api/cli/scheduler**
   - 扩展 `ChatDispatchChannel`，为 `"api"` 注册一个 dispatcher（可以是“写回 HTTP response”的抽象，或直接 no-op + 依赖 output）

## P1：文档与实现漂移（路径与描述不一致）

已观察到的漂移：
- 用户文档提到 `docs/agent-context-engineering.md`，但仓库 `docs/` 为空（本次已补齐工程文档）。
- 文档中出现 `package/src/asset/prompts.txt`，而实际默认提示词在 `package/src/core/agent/prompts.txt:1`。

建议：
- 统一修订 `homepage/content/docs/*` 的路径引用与示例，避免用户按错误路径排查“上下文来源”。

## P1：`prompts.txt` 模板变量未替换（`{{current_time}}`）

现状：
- `package/src/core/agent/prompts.txt:1` 末尾包含 `{{current_time}}`
- `replaceVariablesInPrompts()` 已实现替换：`package/src/core/agent/prompt.ts:1`

影响：
- 模型可能误以为已拿到时间信息，或把占位符当作真实内容

建议（二选一）：
- 继续扩展需要的模板变量（例如 repo 信息/运行参数），或保持只替换 `{{current_time}}` 的最小实现

## P2：工具运行时上下文（ToolRuntimeContext）是全局可变单例

现状：
- `setToolRuntimeContext()` 写入模块级变量：`package/src/core/tools/set/runtime-context.ts:1`

风险：
- 若未来一个进程中存在多个 projectRoot/runtime（多租户/多项目），会互相覆盖，造成工具在错误的 projectRoot 下执行

建议：
- 若未来要支持多项目并存，考虑将 tool runtime context 改为 AsyncLocalStorage（类似 ToolExecutionContext），或显式注入到工具构造器中。

## P2：注释与现实语义不一致（Telegram runtime 缓存）

现状：
- Telegram 继承 `BaseChatAdapter`，使用全局 runtime + 全局队列：`package/src/adapters/base-chat-adapter.ts:1`
- 该注释已对齐为“全局共享 runtime + 单队列”：`package/src/adapters/telegram/bot.ts:1`

建议：
- 对齐注释与真实实现（或恢复 per-chatKey runtime 的设计，但要重新审视并发/资源与工具副作用）。
