/**
 * UIMessage 解析辅助。
 *
 * 关键点（中文）
 * - 这些能力属于 runtime 执行结果处理，不属于 prompts 组装
 * - 用于提取最终 assistant 文本与工具调用摘要
 */

import {
  getToolName,
  isTextUIPart,
  isToolUIPart,
  type UIDataTypes,
  type UIMessagePart,
  type UITools,
} from "ai";
import type { ShipContextMessageV1 } from "../types/ContextMessage.js";
import type { JsonObject, JsonValue } from "../../types/Json.js";

type AnyUiMessagePart = UIMessagePart<UIDataTypes, UITools>;
type ToolCallSummary = {
  tool: string;
  input: JsonObject;
  output: string;
};

type ToolPartCompatShape = {
  input?: JsonValue;
  rawInput?: JsonValue;
  arguments?: JsonValue;
};

function toUiParts(message: ShipContextMessageV1 | null | undefined): AnyUiMessagePart[] {
  return Array.isArray(message?.parts) ? message.parts : [];
}

function normalizeJsonValue(value: JsonValue | object | undefined): JsonValue {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

function toToolInput(rawInput: JsonValue | object | undefined): JsonObject {
  const normalized = normalizeJsonValue(rawInput);
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    return normalized as JsonObject;
  }
  return { value: normalized };
}

/**
 * 从 UIMessage 中提取纯文本。
 */
export function extractTextFromUiMessage(
  message: ShipContextMessageV1 | null | undefined,
): string {
  const parts = toUiParts(message);
  return parts
    .filter(isTextUIPart)
    .map((part) => String(part.text ?? ""))
    .join("\n")
    .trim();
}

/**
 * 从 UIMessage 中提取 tool 调用记录。
 */
export function extractToolCallsFromUiMessage(
  message: ShipContextMessageV1 | null | undefined,
): ToolCallSummary[] {
  const parts = toUiParts(message);
  const out: ToolCallSummary[] = [];

  for (const part of parts) {
    if (!isToolUIPart(part)) continue;

    const toolName = String(getToolName(part) || "");
    if (!toolName) continue;

    const partObject = part as ToolPartCompatShape;
    const rawInput =
      part.input ?? partObject.rawInput ?? partObject.arguments ?? undefined;
    const input = toToolInput(rawInput);

    const outputObj =
      part.state === "output-available"
        ? part.output
        : part.state === "output-error"
          ? { error: part.errorText ?? "tool_error" }
          : part.state === "output-denied"
            ? { error: "tool_denied", reason: part.approval?.reason }
            : undefined;
    const output =
      outputObj === undefined
        ? ""
        : (() => {
            try {
              return JSON.stringify(outputObj);
            } catch {
              return String(outputObj);
            }
          })();

    out.push({
      tool: toolName,
      input,
      output,
    });
  }

  return out;
}
