import type { JsonObject } from "../types/Json.js";

export const MCP_JSON_SCHEMA: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://shipmyagent.dev/schemas/mcp.schema.json",
  title: "ShipMyAgent MCP config (.ship/config/mcp.json)",
  type: "object",
  additionalProperties: true,
  properties: {
    $schema: {
      type: "string",
      description:
        "JSON Schema reference for editor/IDE validation (e.g. ../schema/mcp.schema.json).",
    },
    servers: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/serverConfig" },
    },
  },
  required: ["servers"],
  $defs: {
    serverConfig: {
      oneOf: [{ $ref: "#/$defs/stdio" }, { $ref: "#/$defs/sse" }, { $ref: "#/$defs/http" }],
    },
    stdio: {
      type: "object",
      additionalProperties: true,
      properties: {
        type: { const: "stdio" },
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
      required: ["type", "command"],
    },
    sse: {
      type: "object",
      additionalProperties: true,
      properties: {
        type: { const: "sse" },
        url: { type: "string" },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
      required: ["type", "url"],
    },
    http: {
      type: "object",
      additionalProperties: true,
      properties: {
        type: { const: "http" },
        url: { type: "string" },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
      required: ["type", "url"],
    },
  },
};
