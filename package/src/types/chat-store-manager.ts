import type { ChatStore } from "../chat/store/store.js";

/**
 * ChatStoreManager：按 chatKey 获取 ChatStore 的最小接口。
 *
 * 关键点（中文）
 * - 这是“能力接口”，不是具体实现：ChatRuntime 等都可以实现它
 * - 工具侧只需要 `get(chatKey)`，不应依赖更复杂的运行时对象
 */
export type ChatStoreManager = {
  get(chatKey: string): ChatStore;
};
