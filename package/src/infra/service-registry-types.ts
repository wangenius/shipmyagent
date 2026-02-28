/**
 * 服务注册契约类型转发。
 *
 * 关键点（中文）
 * - 源定义在 core/services/types
 * - services 通过 infra 引用，保持分层边界
 *
 * 边界策略（中文）
 * - infra 只做“契约转发”，不承载业务实现。
 */

export type {
  CliCommandRegistry,
  ServerRouteRegistry,
  SmaServiceCommandResult,
  SmaServiceLifecycle,
  SmaServiceRuntimeState,
  SmaService,
} from "../core/services/types/service-registry.js";
