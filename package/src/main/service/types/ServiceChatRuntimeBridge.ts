import type { ShipContextMessageV1 } from "../../../core/types/ContextMessage.js";

/**
 * Service Chat Runtime Bridge 类型定义。
 *
 * 关键点（中文）
 * - 由 server 注入 chat 相关运行时能力，避免 service 之间直接依赖
 * - task/skills 等 service 通过统一桥接接口访问“聊天回发”能力
 * - 能力字段固定在统一依赖对象中，是否使用由具体 service 自行决定
 */

export type ServiceChatSendByContextIdParams = {
  contextId: string;
  text: string;
};

export type ServiceChatSendByContextIdResult = {
  success: boolean;
  error?: string;
};

export type ServiceChatRuntimeBridge = {
  pickLastSuccessfulChatSendText(
    message: ShipContextMessageV1 | null | undefined,
  ): string;
  sendTextByContextId(
    params: ServiceChatSendByContextIdParams,
  ): Promise<ServiceChatSendByContextIdResult>;
};
