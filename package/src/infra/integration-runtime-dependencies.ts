import type {
  IntegrationModelFactory,
  IntegrationSessionManager,
  IntegrationSessionRequestContextBridge,
} from "./integration-runtime-ports.js";
import type { IntegrationChatRuntimeBridge } from "./integration-chat-runtime-bridge.js";
import type { IntegrationRuntimeDependencies } from "./integration-runtime-types.js";

/**
 * Integration 运行时依赖 helper（显式 DI）。
 *
 * 关键点（中文）
 * - 不再使用全局可变状态（无 set/get 单例）
 * - 所有能力都通过参数传入，调用方显式声明依赖
 */

export function getIntegrationRuntimeDependencies(
  context: IntegrationRuntimeDependencies,
): IntegrationRuntimeDependencies {
  return context;
}

export function getIntegrationSessionManager(
  context: IntegrationRuntimeDependencies,
): IntegrationSessionManager {
  if (context.sessionManager) return context.sessionManager;
  throw new Error(
    "Integration sessionManager is required but missing. Ensure server injects sessionManager before invoking this capability.",
  );
}

export function getIntegrationChatRuntimeBridge(
  context: IntegrationRuntimeDependencies,
): IntegrationChatRuntimeBridge {
  if (context.chatRuntimeBridge) return context.chatRuntimeBridge;
  throw new Error(
    "Integration chatRuntimeBridge is required but missing. Ensure server injects chat bridge before invoking this capability.",
  );
}

export function getIntegrationRequestContextBridge(
  context: IntegrationRuntimeDependencies,
): IntegrationSessionRequestContextBridge {
  if (context.requestContextBridge) return context.requestContextBridge;
  throw new Error(
    "Integration requestContextBridge is required but missing. Ensure server injects request context bridge before invoking this capability.",
  );
}

export function getIntegrationModelFactory(
  context: IntegrationRuntimeDependencies,
): IntegrationModelFactory {
  if (context.modelFactory) return context.modelFactory;
  throw new Error(
    "Integration modelFactory is required but missing. Ensure server injects model factory before invoking this capability.",
  );
}
