/**
 * Context 相关的跨模块类型定义。
 *
 * 约定
 * - ChatStore（.ship/chat/<chatKey>/conversations/history.jsonl）记录的是“用户视角”的 platform transcript。
 * - Agent 不再维护“跨轮 in-memory history”；每次执行都以 ChatStore transcript 作为历史来源，
 *   并以“一条 assistant message”注入到本次 in-flight messages 中。
 */

/**
 * Chat transcript 注入参数（对话式注入，单条 assistant message）。
 */
export type ChatTranscriptInjectionOptions = {
  /**
   * 从最新往前取多少条（只统计 user/assistant entry）。
   */
  count: number;
  /**
   * 相对最新消息的偏移量（例如 offset=10 表示跳过最近 10 条再往前取 count 条）。
   */
  offset?: number;
  /**
   * 注入内容的最大字符数（超出则截断并提示）。
   */
  maxChars?: number;
};
