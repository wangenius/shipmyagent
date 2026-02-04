# ShipMyAgent package/ 架构与实现笔记（工程向）

更新时间：2026-02-04

这些文档面向 **shipmyagent 仓库维护者/贡献者**（偏工程实现），用于快速理解 `package/` 的模块划分、消息链路、上下文管理与关键风险点。

> 说明：仓库还包含 `homepage/content/docs/*` 的用户文档；本目录仅放“工程实现笔记”。

## 目录

- `docs/package-architecture.md`：`package/` 模块与依赖分层总览
- `docs/platform-message-pipeline.md`：platform 与消息链路（adapter → queue → context → tool/dispatcher）
- `docs/context-and-runtime.md`：context 工程与 Agent 执行时的上下文管理（system/history/注入/日志）
- `docs/risk-and-recommendations.md`：关键不一致点、风险与建议（按优先级）

