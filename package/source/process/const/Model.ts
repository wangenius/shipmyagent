export const MODEL_CONFIGS = {
  // Claude 系列
  "claude-sonnet-4-5": {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  },
  "claude-haiku": {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  },
  "claude-3-5-sonnet-20241022": {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  },
  "claude-3-opus-20240229": {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
  },
  // OpenAI GPT 系列
  "gpt-4": {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  "gpt-4-turbo": {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  "gpt-4o": {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  "gpt-3.5-turbo": {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  // DeepSeek
  "deepseek-chat": {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
  },
  // 自定义模型
  custom: {
    provider: "custom",
    baseUrl: "",
  },
};