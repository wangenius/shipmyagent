import type { ShipConfig } from "../types/ShipConfig.js";

export const DEFAULT_SHIP_JSON: ShipConfig = {
  $schema: "./.ship/schema/ship.schema.json",
  name: "shipmyagent",
  version: "1.0.0",
  start: {
    port: 3000,
    host: "0.0.0.0",
    interactiveWeb: false,
    interactivePort: 3001,
  },
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "${API_KEY}",
    temperature: 0.7,
  },
  context: {
    messages: {
      keepLastMessages: 30,
      maxInputTokensApprox: 16000,
      archiveOnCompact: true,
    },
    contextQueue: {
      maxConcurrency: 2,
      enableCorrectionMerge: true,
      correctionMaxRounds: 2,
      correctionMaxMergedMessages: 5,
    },
  },
  permissions: {
    read_repo: true,
    write_repo: {
      requiresApproval: false,
    },
    exec_command: {
      deny: ["rm"],
      requiresApproval: false,
      denyRequiresApproval: true,
      maxOutputChars: 12000,
      maxOutputLines: 200,
    },
  },
  services: {
    chat: {
      adapters: {
        telegram: {
          enabled: false,
          botToken: undefined,
          chatId: undefined,
        },
      },
    },
  },
};
