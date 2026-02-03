/**
 * LLM provider/model factory for AgentRuntime.
 *
 * Responsibilities:
 * - Resolve provider-specific clients (Anthropic/OpenAI/OpenAI-compatible)
 * - Normalize config placeholders (e.g. `${}`) and environment-variable API keys
 * - Wrap `fetch` with LLM request logging so runtime telemetry stays consistent
 * - Construct the AI SDK ToolLoopAgent with the runtime toolset
 *
 * This module intentionally contains only "wiring" logic; execution orchestration
 * lives in `runtime.ts`.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  ToolLoopAgent,
  stepCountIs,
  type LanguageModel,
  type ToolLoopAgent as ToolLoopAgentType,
} from "ai";
import { createLlmLoggingFetch } from "../../telemetry/index.js";
import type { ShipConfig } from "../../utils.js";

type AgentLoggerLike = {
  log: (level: string, message: string, data?: Record<string, unknown>) => Promise<void>;
};

export async function createModelAndAgent(input: {
  config: ShipConfig;
  agentMd: string;
  logger: AgentLoggerLike;
  tools: Record<string, any>;
}): Promise<{ model: LanguageModel; agent: ToolLoopAgentType<never, any, any> } | null> {
  const { provider, apiKey, baseUrl, model } = input.config.llm;
  const resolvedModel = model === "${}" ? undefined : model;
  const resolvedBaseUrl = baseUrl === "${}" ? undefined : baseUrl;

  if (!resolvedModel) {
    await input.logger.log("warn", "No LLM model configured, will use simulation mode");
    return null;
  }

  let resolvedApiKey = apiKey;
  if (apiKey && apiKey.startsWith("${") && apiKey.endsWith("}")) {
    const envVar = apiKey.slice(2, -1);
    resolvedApiKey = process.env[envVar];
  }

  if (!resolvedApiKey) {
    resolvedApiKey =
      process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.API_KEY;
  }

  if (!resolvedApiKey) {
    await input.logger.log("warn", "No API Key configured, will use simulation mode");
    return null;
  }

  const envLog = process.env.SMA_LOG_LLM_MESSAGES;
  const configLog = (input.config as any)?.llm?.logMessages;
  const logLlmMessages =
    typeof envLog === "string"
      ? envLog !== "0"
      : typeof configLog === "boolean"
        ? configLog
        : true;

  const loggingFetch = createLlmLoggingFetch({
    logger: input.logger as any,
    enabled: logLlmMessages,
  });

  let modelInstance: LanguageModel;
  if (provider === "anthropic") {
    const anthropicProvider = createAnthropic({
      apiKey: resolvedApiKey,
      fetch: loggingFetch as any,
    });
    modelInstance = anthropicProvider(resolvedModel);
  } else if (provider === "custom") {
    const compatProvider = createOpenAICompatible({
      name: "custom",
      apiKey: resolvedApiKey,
      baseURL: resolvedBaseUrl || "https://api.openai.com/v1",
      fetch: loggingFetch as any,
    });
    modelInstance = compatProvider(resolvedModel);
  } else {
    const openaiProvider = createOpenAI({
      apiKey: resolvedApiKey,
      baseURL: resolvedBaseUrl || "https://api.openai.com/v1",
      fetch: loggingFetch as any,
    });
    modelInstance = openaiProvider(resolvedModel);
  }

  const agent = new ToolLoopAgent({
    model: modelInstance,
    instructions: input.agentMd,
    tools: input.tools,
    stopWhen: stepCountIs(20),
    maxOutputTokens: input.config.llm.maxTokens || 4096,
    temperature: input.config.llm.temperature || 0.7,
    topP: input.config.llm.topP,
    frequencyPenalty: input.config.llm.frequencyPenalty,
    presencePenalty: input.config.llm.presencePenalty,
  });

  return { model: modelInstance, agent };
}
