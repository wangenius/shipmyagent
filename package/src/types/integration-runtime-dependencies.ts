import type { Logger } from "../telemetry/index.js";
import type {
  IntegrationModelFactory,
  IntegrationSessionManager,
  IntegrationSessionRequestContextBridge,
} from "./integration-runtime-ports.js";
import type { IntegrationChatRuntimeBridge } from "./integration-chat-runtime-bridge.js";
import type { ShipConfig } from "../utils.js";

/**
 * Integration 统一运行时依赖。
 *
 * 关键点（中文）
 * - 所有 integrations 使用同一套注入依赖类型，保证可扩展性
 * - 是否使用某个字段由具体 integration 自行决定
 * - 具体实现由 server 注入，intergrations 仅依赖抽象端口
 */
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
