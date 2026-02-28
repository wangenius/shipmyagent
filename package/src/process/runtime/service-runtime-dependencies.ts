import type {
  ServiceModelFactory,
  ServiceContextManager,
  ServiceContextRequestContextBridge,
} from "./types/service-runtime-ports.js";
import type { ServiceChatRuntimeBridge } from "./types/service-chat-runtime-bridge.js";
import type { ServiceRuntimeDependencies } from "./types/service-runtime-types.js";

/**
 * Service 运行时依赖 helper（显式 DI）。
 *
 * 关键点（中文）
 * - 不再使用全局可变状态（无 set/get 单例）
 * - 所有能力都通过参数传入，调用方显式声明依赖
 */

/**
 * 返回注入的 service runtime 依赖。
 *
 * 用途（中文）
 * - 显式透传，便于在模块内部二次分发，不引入全局状态。
 */
export function getServiceRuntimeDependencies(
  context: ServiceRuntimeDependencies,
): ServiceRuntimeDependencies {
  return context;
}

/**
 * 获取 contextManager 端口。
 *
 * 失败语义（中文）
 * - 缺失时直接抛错，提示必须由 server 注入。
 */
export function getServiceContextManager(
  context: ServiceRuntimeDependencies,
): ServiceContextManager {
  if (context.contextManager) return context.contextManager;
  throw new Error(
    "Service contextManager is required but missing. Ensure server injects contextManager before invoking this capability.",
  );
}

/**
 * 获取 chat runtime bridge。
 */
export function getServiceChatRuntimeBridge(
  context: ServiceRuntimeDependencies,
): ServiceChatRuntimeBridge {
  if (context.chatRuntimeBridge) return context.chatRuntimeBridge;
  throw new Error(
    "Service chatRuntimeBridge is required but missing. Ensure server injects chat bridge before invoking this capability.",
  );
}

/**
 * 获取 request context bridge。
 */
export function getServiceRequestContextBridge(
  context: ServiceRuntimeDependencies,
): ServiceContextRequestContextBridge {
  if (context.requestContextBridge) return context.requestContextBridge;
  throw new Error(
    "Service requestContextBridge is required but missing. Ensure server injects request context bridge before invoking this capability.",
  );
}

/**
 * 获取模型工厂端口。
 */
export function getServiceModelFactory(
  context: ServiceRuntimeDependencies,
): ServiceModelFactory {
  if (context.modelFactory) return context.modelFactory;
  throw new Error(
    "Service modelFactory is required but missing. Ensure server injects model factory before invoking this capability.",
  );
}
