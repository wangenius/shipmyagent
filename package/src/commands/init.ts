/**
 * `shipmyagent init`：在目标目录生成最小可用的 ShipMyAgent 工程骨架与配置文件。
 *
 * 目标
 * - 生成 `Agent.md` / `ship.json` / `.ship/` 目录结构与 schema 文件
 * - 通过交互式问题收集必要配置（模型、Adapters 等）
 *
 * 设计要点
 * - Adapters 支持多选：仅写入用户选择的 adapters（未选择的不出现在 `ship.json`）
 * - 避免写入无意义的默认值：能省则省，保持配置简洁
 */

import path from "path";
import prompts from "prompts";
import fs from "fs-extra";
import { execa } from "execa";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  getAgentMdPath,
  getShipJsonPath,
  getShipDirPath,
  getLogsDirPath,
  getCacheDirPath,
  getShipSchemaPath,
  getShipSessionRootDirPath,
  getShipConfigDirPath,
  getShipDataDirPath,
  getShipMcpConfigPath,
  getShipMcpSchemaPath,
  getShipProfileDirPath,
  getShipProfileOtherPath,
  getShipProfilePrimaryPath,
  getShipDebugDirPath,
  getShipPublicDirPath,
  getShipTasksDirPath,
  ensureDir,
  saveJson,
  DEFAULT_SHIP_JSON,
  MODEL_CONFIGS,
  ShipConfig,
} from "../utils.js";
import { SHIP_JSON_SCHEMA } from "../schemas/ship.schema.js";
import { MCP_JSON_SCHEMA } from "../schemas/mcp.schema.js";
import type { AdapterKey, InitOptions } from "./types/init.js";

/**
 * 获取用户级 `.ship/skills` 目录。
 */
function getUserShipSkillsDir(): string {
  return path.join(os.homedir(), ".ship", "skills");
}

/**
 * 推断发布包内置 skills 目录。
 */
function getBuiltInSkillsDirFromBin(): string {
  // 关键点（中文）
  // - 发布包中该文件在 `bin/commands/init.js`
  // - 内置 skills 会在 build 阶段复制到 `bin/intergrations/skills/built-in`
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const binRoot = path.resolve(__dirname, "..");
  return path.join(binRoot, "intergrations", "skills", "built-in");
}

/**
 * 安装内置 skills 到用户目录。
 *
 * 关键点（中文）
 * - 采用覆盖复制策略，保证升级后用户目录可获得最新内置能力。
 */
async function installBuiltInSkillsToUserDir(): Promise<void> {
  const src = getBuiltInSkillsDirFromBin();
  const dst = getUserShipSkillsDir();

  try {
    if (!(await fs.pathExists(src))) return;
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) return;
  } catch {
    return;
  }

  try {
    await fs.ensureDir(dst);
    // 关键点（中文）：覆盖复制，保证升级后内置 skills 可更新到用户目录。
    await fs.copy(src, dst, { overwrite: true, dereference: true });
    console.log(`✅ Installed built-in skills to ${dst}`);
  } catch (err) {
    console.log(`⚠️  Failed to install built-in skills to ${dst}`);
    console.log(`   Error: ${String(err)}`);
  }
}

/**
 * 同步 `~/.claude/skills` 到 `~/.ship/skills`。
 *
 * 关键点（中文）
 * - 这是兼容开发者本地习惯的“软同步”，失败不阻断 init。
 */
async function syncClaudeSkillsToUserShipSkills(): Promise<void> {
  const src = path.join(os.homedir(), ".claude", "skills");
  const dst = getUserShipSkillsDir();
  try {
    if (!(await fs.pathExists(src))) return;
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) return;
    await fs.ensureDir(dst);
    await fs.copy(src, dst, { overwrite: true, dereference: true });
  } catch {
    // ignore
  }
}

/**
 * init 命令入口。
 *
 * 流程（中文）
 * 1) 校验项目目录与覆盖策略
 * 2) 交互收集配置
 * 3) 生成配置与目录
 * 4) 可选安装推荐 skills
 */
export async function initCommand(
  cwd: string = ".",
  options: InitOptions = {},
): Promise<void> {
  const projectRoot = path.resolve(cwd);
  let allowOverwrite = Boolean(options.force);
  const LLM_API_KEY = "${LLM_API_KEY}";
  const LLM_BASE_URL = "${LLM_BASE_URL}";
  const LLM_MODEL = "${LLM_MODEL}";
  const TELEGRAM_BOT_TOKEN = "${TELEGRAM_BOT_TOKEN}";
  const TELEGRAM_CHAT_ID = "${TELEGRAM_CHAT_ID}";
  const FEISHU_APP_ID = "${FEISHU_APP_ID}";
  const FEISHU_APP_SECRET = "${FEISHU_APP_SECRET}";
  const QQ_APP_ID = "${QQ_APP_ID}";
  const QQ_APP_SECRET = "${QQ_APP_SECRET}";

  console.log(`🚀 Initializing ShipMyAgent project: ${projectRoot}`);

  // Check if core initialization files already exist
  const existingAgentMd = fs.existsSync(getAgentMdPath(projectRoot));
  const existingShipJson = fs.existsSync(getShipJsonPath(projectRoot));

  if (existingAgentMd || existingShipJson) {
    if (!allowOverwrite) {
      const response = await prompts({
        type: "confirm",
        name: "overwrite",
        message:
          "Project already initialized. Overwrite existing configuration files?",
        initial: false,
      });

      if (!response.overwrite) {
        console.log("❌ Initialization cancelled");
        return;
      }
      allowOverwrite = true;
    }
  }

  // Collect configuration information
  // 交互采集（中文）：模型 + adapters + 推荐 skills，最小化首启配置成本。
  const response = await prompts([
    {
      type: "text",
      name: "name",
      message: "Agent name",
      initial: path.basename(projectRoot),
    },
    {
      type: "select",
      name: "model",
      message: "Select LLM model",
      choices: [
        { title: "Claude Sonnet 4", value: "claude-sonnet-4-5" },
        { title: "Claude Haiku", value: "claude-haiku" },
        { title: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-20241022" },
        { title: "Claude 3 Opus", value: "claude-3-opus-20240229" },
        { title: "GPT-4", value: "gpt-4" },
        { title: "GPT-4 Turbo", value: "gpt-4-turbo" },
        { title: "GPT-4o", value: "gpt-4o" },
        { title: "GPT-3.5 Turbo", value: "gpt-3.5-turbo" },
        { title: "DeepSeek Chat", value: "deepseek-chat" },
        { title: "Custom model", value: "custom" },
      ],
      initial: 0,
    },
    {
      // 关键交互: Adapters 允许多选，未选择的就不写入 ship.json
      type: "multiselect",
      name: "adapters",
      message: "Select adapters (multi-select)",
      choices: [
        { title: "Telegram", value: "telegram" },
        { title: "Feishu", value: "feishu" },
        { title: "QQ", value: "qq" },
      ],
    },
    {
      type: (prev, values) =>
        Array.isArray(values.adapters) && values.adapters.includes("qq")
          ? "confirm"
          : null,
      name: "qqSandbox",
      message: "Use QQ sandbox environment?",
      initial: false,
    },
    {
      type: "multiselect",
      name: "skillsToInstall",
      message: "Install recommended skills (optional)",
      choices: [
        {
          title: "Vercel React/Next.js Best Practices",
          value: "vercel-labs/agent-skills@vercel-react-best-practices",
        },
        {
          title: "Web Design Guidelines",
          value: "vercel-labs/agent-skills@web-design-guidelines",
        },
        {
          title: "Agent Browser (browser automation)",
          value: "vercel-labs/agent-skills@agent-browser",
        },
      ],
    },
  ]);

  // Create configuration files
  const agentMdPath = getAgentMdPath(projectRoot);
  const shipJsonPath = getShipJsonPath(projectRoot);

  // Save Agent.md (default user identity definition)
  const defaultAgentMd = `# Agent Role

You are a helpful project assistant.

## Your Purpose

Help users understand and work with their codebase by exploring, analyzing, and providing insights.

## Your Approach

- Read and analyze code to answer questions
- Provide specific, actionable guidance
- Explain what you find in the project
- Only modify files when explicitly requested
`;

  await fs.writeFile(agentMdPath, defaultAgentMd);
  console.log(`✅ Created Agent.md`);

  // Save ship.json
  // Build LLM configuration
  const selectedModel = response.model || "claude-sonnet-4-5";
  const modelTemplate = MODEL_CONFIGS[selectedModel as keyof typeof MODEL_CONFIGS] || MODEL_CONFIGS.custom;

  const llmConfig = {
    provider: modelTemplate.provider,
    model: selectedModel === "custom" ? LLM_MODEL : selectedModel, // custom needs env
    baseUrl: selectedModel === "custom" ? LLM_BASE_URL : modelTemplate.baseUrl,
    apiKey: LLM_API_KEY,
    temperature: 0.7,
  };

  const selectedAdapters = new Set<AdapterKey>(
    Array.isArray(response.adapters) ? (response.adapters as AdapterKey[]) : [],
  );

  const adaptersConfig: NonNullable<ShipConfig["adapters"]> = {};
  if (selectedAdapters.has("telegram")) {
    adaptersConfig.telegram = {
      enabled: true,
      botToken: TELEGRAM_BOT_TOKEN,
      // 关键点（中文）：chatId 可选，允许通过环境变量注入（避免把 chatId 写进 ship.json）
      chatId: TELEGRAM_CHAT_ID,
    };
  }
  if (selectedAdapters.has("feishu")) {
    adaptersConfig.feishu = {
      enabled: true,
      appId: FEISHU_APP_ID,
      appSecret: FEISHU_APP_SECRET,
      domain: "https://open.feishu.cn",
    };
  }
  if (selectedAdapters.has("qq")) {
    adaptersConfig.qq = {
      enabled: true,
      appId: QQ_APP_ID,
      appSecret: QQ_APP_SECRET,
      sandbox: Boolean(response.qqSandbox),
    };
  }

  const shipConfig: ShipConfig = {
    $schema: DEFAULT_SHIP_JSON.$schema,
    name: response.name || path.basename(projectRoot),
    version: "1.0.0",
    start: {
      port: 3000,
      host: "0.0.0.0",
      interactiveWeb: false,
      interactivePort: 3001,
    },
    llm: llmConfig,
    // 关键点（中文）：默认额外支持 `.claude/skills`（兼容社区/工具链习惯），同时仍保留 `.ship/skills` 作为默认 root
    skills: { paths: [".claude/skills"] },
    ...(Object.keys(adaptersConfig).length > 0 ? { adapters: adaptersConfig } : {}),
  };

  await saveJson(shipJsonPath, shipConfig);
  console.log(`✅ Created ship.json`);

  // Create .env and .env.example (optional, but recommended)
  // 关键点（中文）
  // - `.env.example`：可提交，用于告诉团队需要哪些环境变量
  // - `.env`：本地私密配置，不建议提交
  // - 仅生成“本次 init 选择相关”的变量（减少噪音）
  const dotEnvExamplePath = path.join(projectRoot, ".env.example");
  const dotEnvPath = path.join(projectRoot, ".env");

  const envLines: string[] = [
    "# ShipMyAgent 环境变量",
    "# - .env.example: 可提交到 git（示例）",
    "# - .env: 本地私密配置（不要提交）",
    "",
    "# LLM（ship.json 默认读取 LLM_API_KEY）",
    "LLM_API_KEY=",
  ];

  if (selectedModel === "custom") {
    envLines.push(
      "",
      "# Custom model（OpenAI-compatible）",
      "LLM_MODEL=",
      "LLM_BASE_URL=",
    );
  }

  if (selectedAdapters.has("telegram")) {
    envLines.push(
      "",
      "# Telegram",
      "TELEGRAM_BOT_TOKEN=",
      "# 可选：限制仅在指定 chatId 发送（不填则不限制）",
      "TELEGRAM_CHAT_ID=",
    );
  }

  if (selectedAdapters.has("feishu")) {
    envLines.push(
      "",
      "# Feishu",
      "FEISHU_APP_ID=",
      "FEISHU_APP_SECRET=",
    );
  }

  if (selectedAdapters.has("qq")) {
    envLines.push(
      "",
      "# QQ",
      "QQ_APP_ID=",
      "QQ_APP_SECRET=",
      `QQ_SANDBOX=${Boolean(response.qqSandbox) ? "true" : "false"}`,
    );
  }

  envLines.push("");
  const envTemplate = envLines.join("\n");

  const AUTO_ENV_MARKER = "# ShipMyAgent 环境变量";
  const canOverwriteEnvFile = async (filePath: string): Promise<boolean> => {
    if (options.force) return true;
    if (!(await fs.pathExists(filePath))) return true;
    try {
      const existing = await fs.readFile(filePath, "utf-8");
      // 关键点（中文）：只有“我们自己生成的 env 文件”才允许在非 --force 下覆盖，避免误伤用户自有 .env
      return existing.trimStart().startsWith(AUTO_ENV_MARKER);
    } catch {
      return false;
    }
  };

  const writeTextFile = async (filePath: string, content: string) => {
    if (!(await canOverwriteEnvFile(filePath))) return false;
    await fs.writeFile(filePath, content, "utf-8");
    return true;
  };

  const wroteEnvExample = await writeTextFile(dotEnvExamplePath, envTemplate);
  const wroteEnv = await writeTextFile(dotEnvPath, envTemplate);

  if (wroteEnvExample) console.log("✅ Created .env.example");
  else if (await fs.pathExists(dotEnvExamplePath)) {
    console.log("⏭️  Skipped existing .env.example (use --force to overwrite)");
  }
  if (wroteEnv) console.log("✅ Created .env");
  else if (await fs.pathExists(dotEnvPath)) {
    console.log("⏭️  Skipped existing .env (use --force to overwrite)");
  }

  // Create .ship directory structure
  const dirs = [
    getShipDirPath(projectRoot),
    getShipTasksDirPath(projectRoot),
    getLogsDirPath(projectRoot),
    getCacheDirPath(projectRoot),
    getShipProfileDirPath(projectRoot),
    getShipDataDirPath(projectRoot),
    getShipSessionRootDirPath(projectRoot),
    getShipPublicDirPath(projectRoot),
    getShipConfigDirPath(projectRoot),
    path.join(getShipDirPath(projectRoot), "skills"),
    path.join(projectRoot, ".claude", "skills"),
    path.join(getShipDirPath(projectRoot), "schema"),
    getShipDebugDirPath(projectRoot),
  ];

  for (const dir of dirs) {
    await ensureDir(dir);
  }
  console.log(`✅ Created .ship/ directory structure`);

  // Write JSON schema for ship.json (for editor validation via "$schema")
  const shipSchemaPath = getShipSchemaPath(projectRoot);
  await ensureDir(path.dirname(shipSchemaPath));
  await saveJson(shipSchemaPath, SHIP_JSON_SCHEMA);
  console.log(`✅ Created ship.schema.json`);

  // Create profile memory files (optional, but recommended)
  try {
    await ensureDir(getShipProfileDirPath(projectRoot));
    await fs.ensureFile(getShipProfilePrimaryPath(projectRoot));
    await fs.ensureFile(getShipProfileOtherPath(projectRoot));
  } catch {
    // ignore
  }

  // Create default mcp.json file in .ship/config/ directory + schema in .ship/schema/
  const mcpSchemaPath = getShipMcpSchemaPath(projectRoot);
  const mcpJsonPath = getShipMcpConfigPath(projectRoot);
  await ensureDir(path.dirname(mcpSchemaPath));
  await ensureDir(path.dirname(mcpJsonPath));
  await saveJson(mcpSchemaPath, MCP_JSON_SCHEMA);
  await saveJson(mcpJsonPath, { $schema: "../schema/mcp.schema.json", servers: {} });
  console.log(`✅ Created .ship/config/mcp.json (MCP configuration)`);

  // Install built-in skills to user directory (~/.ship/skills)
  await installBuiltInSkillsToUserDir();

  // Skills installation (optional)
  const skillsToInstall: string[] = Array.isArray((response as any).skillsToInstall)
    ? ((response as any).skillsToInstall as any[]).map((x) => String(x)).filter(Boolean)
    : [];

  if (skillsToInstall.length > 0) {
    console.log("\n🧩 Installing skills via `npx skills` (global, claude-code) ...");
    for (const spec of skillsToInstall) {
      try {
        // 关键点（中文）
        // - `-y`（npx）：跳过安装确认
        // - `-g`：`npx skills` 默认全局安装到 ~/.claude/skills
        // - `--agent claude-code`：对齐 Claude Code-compatible 目录结构（SKILL.md）
        await execa(
          "npx",
          ["-y", "skills", "add", spec, "--agent", "claude-code", "-g", "-y"],
          { stdio: "inherit" },
        );
      } catch (err) {
        console.log(`⚠️  Failed to install skill: ${spec}`);
        console.log(`   Error: ${String(err)}`);
      }
    }
    // 同步到 `~/.ship/skills`，保证 ShipMyAgent 可发现
    await syncClaudeSkillsToUserShipSkills();
  }

  console.log('\n🎉 Initialization complete!\n');
  console.log(`📦 Current model: ${llmConfig.provider} / ${llmConfig.model}`);
  console.log(`🌐 API URL: ${llmConfig.baseUrl}\n`);

  if (selectedAdapters.has("feishu")) {
    console.log("📱 Feishu adapter enabled");
    console.log("   Please configure FEISHU_APP_ID and FEISHU_APP_SECRET in ship.json");
    console.log("   or set environment variables: FEISHU_APP_ID and FEISHU_APP_SECRET\n");
  }
  if (selectedAdapters.has("telegram")) {
    console.log("📱 Telegram adapter enabled");
    console.log("   Please configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (optional) in ship.json");
    console.log("   or set environment variables: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID\n");
  }
  if (selectedAdapters.has("qq")) {
    console.log("📱 QQ adapter enabled");
    console.log("   Please configure QQ_APP_ID and QQ_APP_SECRET in ship.json");
    console.log("   or set environment variables: QQ_APP_ID and QQ_APP_SECRET\n");
    console.log("   Optional: set QQ_SANDBOX=true to use sandbox environment\n");
  }

  const nextSteps: string[] = [
    "Edit Agent.md to customize agent behavior",
    "Edit ship.json to modify LLM configuration (baseUrl, apiKey, temperature, etc.)",
    "(Optional) Edit .ship/config/mcp.json to configure MCP servers for extended capabilities",
  ];

  if (selectedAdapters.has("telegram")) {
    nextSteps.push("Configure Telegram Bot Token and Chat ID (optional)");
  }
  if (selectedAdapters.has("feishu")) {
    nextSteps.push("Configure Feishu App ID and App Secret");
  }
  if (selectedAdapters.has("qq")) {
    nextSteps.push("Configure QQ App ID and App Secret");
  }
  nextSteps.push('Run "shipmyagent start" to start the agent');

  console.log("Next steps:");
  for (const [idx, line] of nextSteps.entries()) {
    console.log(`  ${idx + 1}. ${line}`);
  }
  console.log("");
  console.log('💡 Tip: API Key is recommended to use environment variables (e.g. ${ANTHROPIC_API_KEY} or ${OPENAI_API_KEY})\n');
  console.log("🔌 MCP Support: Configure MCP servers in .ship/config/mcp.json to connect to databases, APIs, and more");
  console.log("   Learn more: https://modelcontextprotocol.io\n");
  console.log("To switch models or modify configuration, edit the llm field in ship.json directly.\n");
}
