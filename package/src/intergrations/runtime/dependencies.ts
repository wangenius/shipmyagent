import type {
  IntegrationModelFactory,
  IntegrationSessionManager,
  IntegrationSessionRequestContextBridge,
} from "../../types/integration-runtime-ports.js";
import type { IntegrationChatRuntimeBridge } from "../../types/integration-chat-runtime-bridge.js";
import type { IntegrationRuntimeDependencies } from "../../types/integration-runtime-dependencies.js";

/**
 * Integration 统一依赖注入容器。
 *
 * 关键点（中文）
 * - server 启动时注入一次
 * - integrations 侧统一读取同一份依赖对象
 */

let deps: IntegrationRuntimeDependencies | null = null;

export function setIntegrationRuntimeDependencies(
  next: IntegrationRuntimeDependencies,
): void {
  deps = next;
}

export function getIntegrationRuntimeDependencies(): IntegrationRuntimeDependencies {
  if (deps) return deps;
  throw new Error(
    "Integration runtime dependencies are not initialized. Ensure server startup injects integration runtime dependencies before use.",
  );
}

/**
 * 获取必需的 sessionManager。
 *
 * 关键点（中文）
 * - 统一依赖类型中该字段可选
 * - 需要 session 能力的 integration 在运行时显式声明“必须存在”
 */
export function getIntegrationSessionManager(): IntegrationSessionManager {
  const runtime = getIntegrationRuntimeDependencies();
  if (runtime.sessionManager) return runtime.sessionManager;
  throw new Error(
    "Integration sessionManager is not initialized yet. Ensure server runtime is ready before invoking this integration capability.",
  );
}

/**
 * 获取必需的 chat runtime bridge。
 *
 * 关键点（中文）
 * - 避免 integration 直接跨模块调用 chat runtime
 * - 通过 server 注入统一桥接能力，保证边界一致
 */
export function getIntegrationChatRuntimeBridge(): IntegrationChatRuntimeBridge {
  const runtime = getIntegrationRuntimeDependencies();
  if (runtime.chatRuntimeBridge) return runtime.chatRuntimeBridge;
  throw new Error(
    "Integration chatRuntimeBridge is not initialized yet. Ensure server runtime injects chat bridge before invoking this integration capability.",
  );
}

/**
 * 获取必需的 request context bridge。
 *
 * 关键点（中文）
 * - intergrations 不直接依赖 core request-context
 * - 上下文读取与上下文包裹执行统一由 server 注入
 */
export function getIntegrationRequestContextBridge(): IntegrationSessionRequestContextBridge {
  const runtime = getIntegrationRuntimeDependencies();
  if (runtime.requestContextBridge) return runtime.requestContextBridge;
  throw new Error(
    "Integration requestContextBridge is not initialized yet. Ensure server runtime injects request context bridge before invoking this integration capability.",
  );
}

/**
 * 获取必需的 model factory。
 *
 * 关键点（中文）
 * - intergrations 不直接依赖 core model factory
 * - 模型构造能力由 server 注入
 */
export function getIntegrationModelFactory(): IntegrationModelFactory {
  const runtime = getIntegrationRuntimeDependencies();
  if (runtime.modelFactory) return runtime.modelFactory;
  throw new Error(
    "Integration modelFactory is not initialized yet. Ensure server runtime injects model factory before invoking this integration capability.",
  );
}
