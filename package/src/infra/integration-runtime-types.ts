import type { Logger } from "../telemetry/index.js";
import type {
  IntegrationModelFactory,
  IntegrationContextManager,
  IntegrationContextRequestContextBridge,
} from "./integration-runtime-ports.js";
import type { IntegrationChatRuntimeBridge } from "./integration-chat-runtime-bridge.js";
import type { ShipConfig } from "../utils.js";

/**
 * Integration 统一运行时依赖。
 *
 * 关键点（中文）
 * - 所有 integrations 使用同一套注入依赖类型，保证可扩展性。
 * - 是否使用某个字段由具体 integration 自行决定。
 * - 具体实现由 server 注入，intergrations 仅依赖抽象端口。
 *
 * 字段说明（中文）
 * - `cwd/rootPath/config/logger/systems`：所有 integration 都可用的基础上下文。
 * - 其余可选字段为“能力端口”：由 server 注入，按需使用。
 */
export type IntegrationRuntimeDependencies = {
  cwd: string;
  rootPath: string;
  logger: Logger;
  config: ShipConfig;
  systems: string[];
  contextManager?: IntegrationContextManager;
  chatRuntimeBridge?: IntegrationChatRuntimeBridge;
  requestContextBridge?: IntegrationContextRequestContextBridge;
  modelFactory?: IntegrationModelFactory;
};
