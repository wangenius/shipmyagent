/**
 * Service Chat Runtime Bridge 类型定义。
 *
 * 关键点（中文）
 * - 由 server 注入 chat 相关运行时能力，避免 service 之间直接依赖
 * - task/skills 等 service 通过统一桥接接口访问“聊天回发”能力
 * - 能力字段固定在统一依赖对象中，是否使用由具体 service 自行决定
 */

/**
 * 按 chatKey 发送文本参数。
 */
export type ServiceChatSendByKeyParams = {
  chatKey: string;
  text: string;
};

/**
 * 按 chatKey 发送结果。
 */
export type ServiceChatSendByKeyResult = {
  success: boolean;
  error?: string;
};

/**
 * Chat 运行时桥接端口。
 *
 * - `pickLastSuccessfulChatSendText`：从 toolCalls 还原用户可见文本。
 * - `sendTextByChatKey`：向指定会话回发消息。
 */
export type ServiceChatRuntimeBridge = {
  pickLastSuccessfulChatSendText(toolCalls: unknown[]): string;
  sendTextByChatKey(
    params: ServiceChatSendByKeyParams,
  ): Promise<ServiceChatSendByKeyResult>;
};
