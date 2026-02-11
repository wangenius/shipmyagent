/**
 * Integration Chat Runtime Bridge 类型定义。
 *
 * 关键点（中文）
 * - 由 server 注入 chat 相关运行时能力，避免 integration 之间直接依赖
 * - task/skills 等 integration 通过统一桥接接口访问“聊天回发”能力
 * - 能力字段固定在统一依赖对象中，是否使用由具体 integration 自行决定
 */

export type IntegrationChatSendByKeyParams = {
  chatKey: string;
  text: string;
};

export type IntegrationChatSendByKeyResult = {
  success: boolean;
  error?: string;
};

export type IntegrationChatRuntimeBridge = {
  pickLastSuccessfulChatSendText(toolCalls: unknown[]): string;
  sendTextByChatKey(
    params: IntegrationChatSendByKeyParams,
  ): Promise<IntegrationChatSendByKeyResult>;
};
