# Intergration 开发指南（DI 版）

这份指南只讲一件事：

- **integration 只写业务**
- **server 负责注入依赖**
- **不允许 integration 直接连 core/server/其他 integration**

> 目标：像 Express 插件一样开发 integration —— 通过函数/类接收参数，不读全局单例。

---

## 1) 分层边界（必须遵守）

### 允许

- `server -> core`
- `server -> intergrations`
- `intergrations -> infra`

### 禁止

- `intergrations -> core`
- `intergrations -> server`
- `intergrations A -> intergrations B`

### 为什么

- `server` 是唯一编排层（启动、注入、装配）。
- `integration` 是插件层（业务策略），不能反向依赖框架实现。
- 通用能力放 `infra`（端口类型、基础 helper、通信工具）。

---

## 2) 固定注入依赖（所有 integration 一致）

统一依赖类型：`package/src/infra/integration-runtime-types.ts`

```ts
export type IntegrationRuntimeDependencies = {
  cwd: string;
  rootPath: string;
  logger: Logger;
  config: ShipConfig;
  systems: string[];
  sessionManager?: IntegrationSessionManager;
  chatRuntimeBridge?: IntegrationChatRuntimeBridge;
  requestContextBridge?: IntegrationSessionRequestContextBridge;
  modelFactory?: IntegrationModelFactory;
};
```

规则：

- 字段集合固定（便于扩展与标准化）。
- integration 可按需使用，不需要的字段忽略即可。
- 取能力时通过 `infra/integration-runtime-dependencies.ts` helper，并显式传入 `context`。

---

## 3) 开发模式：函数工厂 / 类构造注入

## 模式 A：函数工厂（推荐做 service）

```ts
// package/src/intergrations/notify/runtime/service.ts
import type { IntegrationRuntimeDependencies } from "../../../infra/integration-runtime-types.js";

export function createNotifyService(context: IntegrationRuntimeDependencies) {
  return {
    async send(text: string) {
      const message = String(text || "").trim();
      if (!message) return { success: false, error: "text is required" };
      await context.logger.log("info", "notify.send", { message });
      return { success: true, message: `[notify] ${message}` };
    },
  };
}
```

## 模式 B：类构造注入（适合 adapter/manager）

```ts
// package/src/intergrations/chat/adapters/base-chat-adapter.ts（真实模式）
export abstract class BaseChatAdapter extends PlatformAdapter {
  protected constructor(params: {
    channel: ChatDispatchChannel;
    context: IntegrationRuntimeDependencies;
  }) {
    super({ channel: params.channel, context: params.context });
  }
}
```

重点：**不要在类内部读取全局 runtime**，一律在构造函数拿 `context`。

---

## 4) module.ts 怎么写（Express 插件风格）

`module.ts` 只做“路由与参数适配”，业务放 service/runtime。

```ts
// package/src/intergrations/notify/module.ts
import type { SmaModule } from "../../infra/module-registry-types.js";
import { createNotifyService } from "./runtime/service.js";

function setupServer(
  registry: Parameters<SmaModule["registerServer"]>[0],
  context: Parameters<SmaModule["registerServer"]>[1],
) {
  const service = createNotifyService(context);

  registry.post("/api/notify/send", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await service.send(String((body as any)?.text || ""));
    return c.json(result, result.success ? 200 : 400);
  });
}

export const notifyModule: SmaModule = {
  name: "notify",
  registerCli() {},
  registerServer(registry, context) {
    setupServer(registry, context);
  },
};
```

---

## 4.1) 类型放置规则（新的约定）

- `core` 内部注册契约（源定义）：`package/src/core/intergration/types/module-registry.ts`
- `intergrations` 侧引用入口（转发）：`package/src/infra/module-registry-types.ts`
- `intergrations/chat` 相关类型：放在 `package/src/intergrations/chat/types/`
- `intergrations/skills` 相关类型：放在 `package/src/intergrations/skills/types/`
- `intergrations/task` 相关类型：放在 `package/src/intergrations/task/types/`
- 不再把业务 DTO 统一堆在 `package/src/types/`

> 原则：类型跟着模块走；只有真正跨层的公共基础类型才放公共目录。

---

## 5) server 如何注入

你不需要在 integration 里做初始化。server 会统一注入：

- `package/src/server/ShipRuntimeContext.ts` 负责构建 `IntegrationRuntimeDependencies`
- `package/src/core/intergration/registry.ts` 调用 `module.registerServer(registry, context)`

即：

- integration 只声明“我需要 context”
- server 决定“给你什么实现”

---

## 6) 常见反例（禁止）

### 反例 1：integration 直接 import core

```ts
// ❌ 不允许
import { withSessionRequestContext } from "../../core/session/request-context.js";
```

### 反例 2：integration 直接 import server

```ts
// ❌ 不允许
import { getShipRuntimeContext } from "../../server/ShipRuntimeContext.js";
```

### 反例 3：integration 之间互相 import

```ts
// ❌ 不允许
import { sendChatTextByChatKey } from "../chat/service.js";
```

如需通用能力：

- 提到 `infra/*`（基础 helper/端口类型/协议）
- 或由 server 注入 bridge（`chatRuntimeBridge`、`modelFactory` 等）

---

## 7) 新增 integration 最小步骤

1. 建目录：`package/src/intergrations/<name>/`
2. 写 `runtime/*`（业务）
3. 写 `module.ts`（CLI/Server 适配）
4. 在 `package/src/core/intergration/registry.ts` 注册模块
5. 运行校验：

```bash
npm --prefix package run lint
npm --prefix package run typecheck
```

---

## 8) 提交前 Checklist

- [ ] `module.ts` 只做注册与参数归一化
- [ ] 业务逻辑在 `service.ts` / `runtime/*`
- [ ] 全部运行时能力来自 `context` 参数
- [ ] 无 `intergrations -> core/server/intergrations` 直连
- [ ] 通用模块放 `infra/*`
- [ ] `lint + typecheck` 全通过
