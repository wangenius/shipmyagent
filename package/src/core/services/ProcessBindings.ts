import {
  clearSystemPromptProviders,
  registerSystemPromptProvider,
} from "../prompts/SystemProvider.js";
import { runContextMemoryMaintenance } from "../../services/memory/runtime/Service.js";
import { memorySystemPromptProvider } from "../../services/memory/runtime/SystemProvider.js";
import { createSkillsSystemPromptProvider } from "../../services/skills/runtime/SystemProvider.js";
import { pickLastSuccessfulChatSendText } from "../../services/chat/runtime/UserVisibleText.js";
import { sendChatTextByContextId } from "../../services/chat/Service.js";
import { getChatSender } from "../../services/chat/runtime/ChatSendRegistry.js";
import { setProcessServiceBindings } from "../../process/runtime/ServiceProcessBindings.js";

/**
 * 绑定 process 所需的具体服务实现。
 *
 * 关键点（中文）
 * - 具体实现只出现在 core/services 层，process 不直接依赖 services/*。
 * - 所有 process -> services 的能力访问都经由抽象 bindings。
 */
setProcessServiceBindings({
  pickLastSuccessfulChatSendText,
  async sendTextByContextId(params) {
    const result = await sendChatTextByContextId(params);
    return {
      success: Boolean(result.success),
      ...(result.success ? {} : { error: result.error || "chat send failed" }),
    };
  },
  async sendChatAction(params) {
    const dispatcher = getChatSender(params.channel);
    if (!dispatcher || typeof dispatcher.sendAction !== "function") return;
    await dispatcher.sendAction({
      chatId: params.chatId,
      action: params.action,
      ...(typeof params.messageThreadId === "number"
        ? { messageThreadId: params.messageThreadId }
        : {}),
      ...(typeof params.chatType === "string" && params.chatType
        ? { chatType: params.chatType }
        : {}),
      ...(typeof params.messageId === "string" && params.messageId
        ? { messageId: params.messageId }
        : {}),
    });
  },
  runMemoryMaintenance: runContextMemoryMaintenance,
  registerSystemPromptProviders: (params) => {
    clearSystemPromptProviders();
    registerSystemPromptProvider(
      createSkillsSystemPromptProvider(params.getContext),
    );
    registerSystemPromptProvider(memorySystemPromptProvider);
  },
});
