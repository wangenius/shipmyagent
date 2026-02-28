/**
 * LLM provider/model factory.
 *
 * 设计目标（中文，关键点）
 * - 这是“核心能力”，不应该依赖 server/RuntimeContext（避免隐式初始化时序）
 * - Agent、Memory extractor 等都可以复用同一套模型构造逻辑
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel } from "ai";
import { createLlmLoggingFetch, getLogger } from "../../logger/index.js";
import type { ShipConfig } from "../../utils.js";

/**
 * 创建 LanguageModel 实例。
 *
 * 解析策略（中文）
 * 1) 解析 provider/model/baseUrl/apiKey（含 `${ENV}` 占位符）
 * 2) 创建带日志拦截的 fetch
 * 3) 按 provider 分发到对应 SDK 工厂
 */
export async function createModel(input: {
  config: ShipConfig;
}): Promise<LanguageModel> {
  const logger = getLogger();

  const { provider, apiKey, baseUrl, model } = input.config.llm;
  const resolvedModel = model === "${}" ? undefined : model;
  const resolvedBaseUrl = baseUrl === "${}" ? undefined : baseUrl;

  if (!resolvedModel) {
    await logger.log("warn", "No LLM model configured");
    throw Error("no LLM Model Configured");
  }

  // API Key 解析（中文）：优先 ship.json；若是 `${ENV}` 则转环境变量读取。
  let resolvedApiKey = apiKey;
  if (apiKey && apiKey.startsWith("${") && apiKey.endsWith("}")) {
    const envVar = apiKey.slice(2, -1);
    resolvedApiKey = process.env[envVar];
  }

  // 兜底策略（中文）：兼容常见环境变量命名。
  if (!resolvedApiKey) {
    resolvedApiKey =
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.API_KEY;
  }

  if (!resolvedApiKey) {
    await logger.log("warn", "No API Key configured, will use simulation mode");
    throw Error("No API Key configured, will use simulation mode");
  }

  // 日志策略（中文）：默认开启 LLM 请求日志，可通过 llm.logMessages 关闭。
  const configLog = (input.config as any)?.llm?.logMessages;
  const logLlmMessages = typeof configLog === "boolean" ? configLog : true;

  const loggingFetch = createLlmLoggingFetch({
    logger,
    enabled: logLlmMessages,
  });

  if (provider === "anthropic") {
    const anthropicProvider = createAnthropic({
      apiKey: resolvedApiKey,
      fetch: loggingFetch as any,
    });
    return anthropicProvider(resolvedModel);
  }

  if (provider === "custom") {
    const compatProvider = createOpenAICompatible({
      name: "custom",
      apiKey: resolvedApiKey,
      baseURL: resolvedBaseUrl || "https://api.openai.com/v1",
      fetch: loggingFetch as any,
    });
    return compatProvider(resolvedModel);
  }

  const openaiProvider = createOpenAI({
    apiKey: resolvedApiKey,
    baseURL: resolvedBaseUrl || "https://api.openai.com/v1",
    fetch: loggingFetch as any,
  });
  return openaiProvider(resolvedModel);
}

