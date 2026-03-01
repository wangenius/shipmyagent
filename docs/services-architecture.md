**服务体系**
本报告说明当前 `services` 模块的整体逻辑、分层职责与主要流程，面向开发者。

**分层结构**
1. `package/src/main/*`：主进程层，负责启动、生命周期、依赖注入与运行时编排。
2. `package/src/main/service/*`：主进程的 service 运行支撑层，提供队列执行器与服务依赖绑定。
3. `package/src/core/*`：核心上下文与 Agent 运行内核。
4. `package/src/services/*`：业务服务模块（chat、task、skills、memory），以插件式契约接入。

**服务契约**
1. 统一服务接口定义在 `package/src/core/services/ServiceRegistry.ts`。
2. 每个服务通过 `SmaService` 暴露三类能力：CLI 注册、HTTP 路由注册、生命周期扩展。
3. 服务入口统一集中在 `package/src/core/services/Registry.ts`，避免零散硬编码。

**依赖注入**
1. Service 的运行依赖类型定义在 `package/src/main/service/types/ServiceRuntimeTypes.ts`。
2. 运行端口定义在 `package/src/main/service/types/ServiceRuntimePorts.ts`，包含 ContextManager、ModelFactory、RequestContext 等最小能力面。
3. 依赖获取助手在 `package/src/main/service/ServiceRuntimeDependencies.ts`，通过显式参数传入，避免全局单例。
4. 进程侧服务实现绑定在 `package/src/main/service/ServiceProcessBindings.ts`，由 `package/src/core/services/ProcessBindings.ts` 进行具体实现注入。
5. 主运行时上下文由 `package/src/main/runtime/ShipRuntimeContext.ts` 构建与注入，确保 services 始终通过统一的 runtime context 访问能力端口。

**核心消息流**
1. 入站消息由各平台适配器接收，写入 `package/src/services/chat/runtime/ChatQueue.ts`。
2. `package/src/main/service/ChatQueueWorker.ts` 在主进程中消费队列，负责写入历史并驱动 Agent 执行。
3. 上下文落盘与 Agent 管理由 `package/src/core/context/ContextManager.ts` 负责。

**服务明细**
**Chat 服务**
1. 入口：`package/src/services/chat/ServiceEntry.ts`
2. 适配器：`package/src/services/chat/adapters/*`
3. 入队：`package/src/services/chat/runtime/ChatQueue.ts`
4. 出站：`package/src/services/chat/runtime/ChatkeySend.ts`
5. Egress 控制：`package/src/services/chat/runtime/EgressIdempotency.ts`

**Task 服务**
1. 入口：`package/src/services/task/ServiceEntry.ts`
2. 任务定义与运行：`package/src/services/task/Service.ts`
3. Cron 运行时：`package/src/services/task/runtime/CronRuntime.ts`
4. 任务执行器：`package/src/services/task/runtime/Runner.ts`
5. 任务路径规范：`package/src/services/task/runtime/Paths.ts`

**Skills 服务**
1. 入口：`package/src/services/skills/ServiceEntry.ts`
2. 发现与加载：`package/src/services/skills/runtime/Discovery.ts`
3. Prompt 生成：`package/src/services/skills/runtime/Prompt.ts`
4. SystemProvider：`package/src/services/skills/runtime/SystemProvider.ts`

**Memory 服务（内部能力）**
1. 无 CLI/HTTP 入口，仅由 core 触发维护。
2. 入口：`package/src/services/memory/runtime/Service.ts`
3. 抽取与压缩：`package/src/services/memory/runtime/Extractor.ts`
4. 管理器：`package/src/services/memory/runtime/Manager.ts`

**CLI 与 Server 入口**
1. CLI 入口：`package/src/main/commands/Index.ts`
2. HTTP Server：`package/src/main/runtime/AgentServer.ts`
3. Daemon 通道：`package/src/main/runtime/daemon/*`

**边界约束**
1. 边界校验脚本：`package/scripts/lint-import-boundaries.mjs`
2. 约束原则：services 不直接依赖 core 与主进程运行时，依赖以端口注入方式获取。
3. 例外通道：CLI 远程调用通过 daemon client 进行，避免 services 直接操作主进程状态。

**运行时配置**
1. 配置类型：`package/src/main/types/ShipConfig.ts`
2. 配置加载：`package/src/main/project/Config.ts`
3. 任务与会话路径：`package/src/main/project/Paths.ts` 与 `package/src/services/task/runtime/Paths.ts`

**总结**
1. `main` 负责“进程级编排与注入”，`core` 负责“上下文与 Agent 内核”，`services` 负责“业务能力插件化”。
2. 所有服务通过统一契约注册与调度，依赖通过端口注入，避免交叉耦合。
3. Chat 入队 + 主进程队列执行是核心运行链路，Task/Skills/Memory 通过同一运行时能力面复用上下文与模型。 
