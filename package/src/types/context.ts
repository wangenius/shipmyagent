/**
 * Context 相关的跨模块类型定义。
 *
 * 约定
 * - ChatStore（.ship/chat/<chatKey>/conversations/history.jsonl）记录的是“用户视角”的 platform transcript。
 */

/**
 * Chat transcript（in-memory message cache）的压缩参数。
 *
 * 说明
 * - 这里的“chat history”指 ContextStore 内维护的会话 messages（用于下一轮 LLM 输入）。
 * - 不是 ChatStore（`.ship/chat/.../conversations`）里的平台 transcript。
 */
export type ChatHistoryCompactionOptions = {
  /**
   * 压缩后保留最后 N 条 messages。
   * - N 越大：更贴近当前任务，但上下文更长
   * - N 越小：更省 tokens，但可能丢失细节
   */
  keepLast: number;
};
