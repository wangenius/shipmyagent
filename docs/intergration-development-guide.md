# Intergration 开发指南（简版）

本文是当前架构下的**最小开发约束**与**落地步骤**，用于新增或改造 `package/src/intergrations/*` 模块。

## 1) 架构边界（先记住这三条）

- `server` 可以调用 `core` 和 `intergrations`
- `intergrations` **不能**直接调用 `server`
- `intergrations` **不能**直接调用 `core`
- `intergrations` 之间也不应互相直连（除 `intergrations/shared/*` 与 `intergrations/runtime/*`）

一句话：`server` 负责编排与注入，`intergrations` 只消费注入能力。

---

## 2) 统一依赖注入模型

统一依赖类型：

- `package/src/types/integration-runtime-dependencies.ts`

统一端口类型：

- `package/src/types/integration-runtime-ports.ts`

统一读取入口：

- `package/src/intergrations/runtime/dependencies.ts`

`server` 注入位置：

- `package/src/server/ShipRuntimeContext.ts`

### 当前推荐模式

1. 在 `types/integration-runtime-ports.ts` 定义“能力端口”（抽象接口）
2. 在 `server/ShipRuntimeContext.ts` 注入具体实现（通常来自 `core`）
3. 在 `intergrations/runtime/dependencies.ts` 提供 `getIntegrationXxx()`
4. 在具体 integration 中调用 `getIntegrationXxx()`，不要直接 import `core/*`

---

## 3) 新增一个 integration 的最小骨架

建议目录：

- `intergrations/<name>/module.ts`：CLI / Server 注册入口
- `intergrations/<name>/service.ts`：业务编排
- `intergrations/<name>/runtime/*`：运行时实现细节
- `intergrations/shared/*`：仅放纯共享能力（无反向依赖）

设计原则：

- `module.ts` 只做“注册与参数适配”，不堆业务逻辑
- 业务逻辑放 `service.ts` / `runtime/*`
- 需要运行时能力时，优先走注入端口，不做跨层 import

---

## 4) 什么时候要新增“注入端口”

当你在 integration 内想用这些能力时，需要走端口注入：

- 请求上下文（例如 `withSessionRequestContext`）
- 会话管理（`sessionManager`）
- 模型工厂（`createModel`）
- 定时调度引擎（cron engine）

不要在 integration 里直接：

- `import ... from "../../core/..."`
- `import ... from "../../server/..."`

---

## 5) 强制检查（lint）

边界检查脚本：

- `package/scripts/lint-import-boundaries.mjs`

执行命令：

```bash
npm --prefix package run lint
npm --prefix package run typecheck
```

当前规则会拦截：

- `intergrations -> server`
- `intergrations -> core`
- `intergrations` 跨模块直连（非 `shared/runtime`）

---

## 6) 常见反模式

- 在 integration 里直接 import `core/session/*`、`core/llm/*`
- 在 `module.ts` 写大量业务逻辑
- 为了“省事”做跨 integration 直接调用
- 把进程状态下沉到 shared（导致边界失真）

---

## 7) 开发 Checklist

- [ ] 没有 `intergrations -> core/server` 直接依赖
- [ ] 需要的能力都通过 `IntegrationRuntimeDependencies` 注入
- [ ] 端口类型定义在 `types/integration-runtime-ports.ts`
- [ ] `module.ts` 保持薄，业务在 `service/runtime`
- [ ] `lint + typecheck` 全通过

