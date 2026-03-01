import type { ShipContextMessageV1 } from "../../core/types/ContextMessage.js";
import type { ServiceRuntimeDependencies } from "./types/ServiceRuntimeTypes.js";

/**
 * 进程侧服务实现绑定。
 *
 * 关键点（中文）
 * - process 仅通过该绑定调用服务能力。
 * - 具体实现由 core/services 在启动阶段注入。
 */
export type ProcessServiceBindings = {
  pickLastSuccessfulChatSendText(
    message: ShipContextMessageV1 | null | undefined,
  ): string;
  sendTextByContextId(params: {
    context: ServiceRuntimeDependencies;
    contextId: string;
    text: string;
  }): Promise<{ success: boolean; error?: string }>;
  sendChatAction(params: {
    channel: "telegram" | "feishu" | "qq";
    chatId: string;
    action: "typing";
    messageThreadId?: number;
    chatType?: string;
    messageId?: string;
  }): Promise<void>;
  runMemoryMaintenance(params: {
    context: ServiceRuntimeDependencies;
    contextId: string;
  }): Promise<void>;
  registerSystemPromptProviders(params: {
    getContext: () => ServiceRuntimeDependencies;
  }): void;
};

const defaultBindings: ProcessServiceBindings = {
  pickLastSuccessfulChatSendText() {
    return "";
  },
  async sendTextByContextId() {
    return {
      success: false,
      error:
        "Process service bindings are not initialized: sendTextByContextId is missing.",
    };
  },
  async sendChatAction() {
    // noop
  },
  async runMemoryMaintenance() {
    // noop
  },
  registerSystemPromptProviders() {
    // noop
  },
};

let bindings: ProcessServiceBindings = defaultBindings;

/**
 * 设置进程侧服务实现绑定。
 */
export function setProcessServiceBindings(next: ProcessServiceBindings): void {
  bindings = next;
}

/**
 * 获取进程侧服务实现绑定。
 */
export function getProcessServiceBindings(): ProcessServiceBindings {
  return bindings;
}
