import path from 'path';
import prompts from 'prompts';
import fs from 'fs-extra';
import {
  getAgentMdPath,
  getShipJsonPath,
  getShipDirPath,
  getTasksDirPath,
  getRunsDirPath,
  getQueueDirPath,
  getRoutesDirPath,
  getApprovalsDirPath,
  getLogsDirPath,
  getCacheDirPath,
  getChatsDirPath,
  getShipSchemaPath,
  getMcpDirPath,
  ensureDir,
  saveJson,
  DEFAULT_SHIP_JSON,
  MODEL_CONFIGS,
  ShipConfig,
} from '../utils.js';
import { SHIP_JSON_SCHEMA } from '../schemas/ship.schema.js';
import { MCP_JSON_SCHEMA } from '../schemas/mcp.schema.js';

interface InitOptions {
  force?: boolean;
}

export async function initCommand(cwd: string = '.', options: InitOptions = {}): Promise<void> {
  const projectRoot = path.resolve(cwd);
  const LLM_API_KEY = '${LLM_API_KEY}';
  const LLM_BASE_URL = '${LLM_BASE_URL}';
  const LLM_MODEL = '${LLM_MODEL}';
  const TELEGRAM_BOT_TOKEN = '${TELEGRAM_BOT_TOKEN}';
  const FEISHU_APP_ID = '${FEISHU_APP_ID}';
  const FEISHU_APP_SECRET = '${FEISHU_APP_SECRET}';
  const QQ_APP_ID = '${QQ_APP_ID}';
  const QQ_APP_SECRET = '${QQ_APP_SECRET}';

  console.log(`🚀 Initializing ShipMyAgent project: ${projectRoot}`);

  // Check if Agent.md and ship.json already exist
  const existingAgentMd = fs.existsSync(getAgentMdPath(projectRoot));
  const existingShipJson = fs.existsSync(getShipJsonPath(projectRoot));

  if (existingAgentMd || existingShipJson) {
    if (!options.force) {
      const response = await prompts({
        type: 'confirm',
        name: 'overwrite',
        message: 'Project already initialized. Overwrite existing configuration?',
        initial: false,
      });

      if (!response.overwrite) {
        console.log('❌ Initialization cancelled');
        return;
      }
    }
  }

  // Collect configuration information
  const response = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Agent name',
      initial: path.basename(projectRoot),
    },
    {
      type: 'select',
      name: 'model',
      message: 'Select LLM model',
      choices: [
        { title: 'Claude Sonnet 4', value: 'claude-sonnet-4-5' },
        { title: 'Claude Haiku', value: 'claude-haiku' },
        { title: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
        { title: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
        { title: 'GPT-4', value: 'gpt-4' },
        { title: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
        { title: 'GPT-4o', value: 'gpt-4o' },
        { title: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
        { title: 'DeepSeek Chat', value: 'deepseek-chat' },
        { title: 'Custom model', value: 'custom' },
      ],
      initial: 0,
    },
    {
      type: 'select',
      name: 'integration',
      message: 'Select messaging integration',
      choices: [
        { title: 'None', value: 'none' },
        { title: 'Telegram', value: 'telegram' },
        { title: 'Feishu', value: 'feishu' },
        { title: 'QQ', value: 'qq' },
      ],
      initial: 0,
    },
    {
      type: (prev, values) => (values.integration === 'qq' ? 'confirm' : null),
      name: 'qqSandbox',
      message: 'Use QQ sandbox environment?',
      initial: false,
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
  const selectedModel = response.model || 'claude-sonnet-4-5';
  const modelTemplate = MODEL_CONFIGS[selectedModel as keyof typeof MODEL_CONFIGS] || MODEL_CONFIGS.custom;

  const llmConfig = {
    provider: modelTemplate.provider,
    model: selectedModel === 'custom' ? LLM_MODEL : selectedModel, // custom needs env
    baseUrl: selectedModel === 'custom' ? LLM_BASE_URL : modelTemplate.baseUrl,
    apiKey: LLM_API_KEY,
    temperature: 0.7,
  };

  const shipConfig: ShipConfig = {
    $schema: DEFAULT_SHIP_JSON.$schema,
    name: response.name || path.basename(projectRoot),
    version: '1.0.0',
    start: {
      port: 3000,
      host: '0.0.0.0',
      interactiveWeb: false,
      interactivePort: 3001,
    },
    llm: llmConfig,
    permissions: DEFAULT_SHIP_JSON.permissions,
    adapters: {
      telegram: {
        enabled: response.integration === 'telegram',
        botToken: response.integration === 'telegram' ? TELEGRAM_BOT_TOKEN : undefined,
        chatId: undefined,
      },
      feishu: {
        enabled: response.integration === 'feishu',
        appId: response.integration === 'feishu' ? FEISHU_APP_ID : undefined,
        appSecret: response.integration === 'feishu' ? FEISHU_APP_SECRET : undefined,
        domain: 'https://open.feishu.cn',
      },
      qq: {
        enabled: response.integration === 'qq',
        appId: response.integration === 'qq' ? QQ_APP_ID : undefined,
        appSecret: response.integration === 'qq' ? QQ_APP_SECRET : undefined,
        sandbox: response.integration === 'qq' ? Boolean(response.qqSandbox) : false,
      },
    },
  };

  await saveJson(shipJsonPath, shipConfig);
  console.log(`✅ Created ship.json`);

  // Create .ship directory structure
  const dirs = [
    getShipDirPath(projectRoot),
    getTasksDirPath(projectRoot),
    getRunsDirPath(projectRoot),
    getQueueDirPath(projectRoot),
    getRoutesDirPath(projectRoot),
    getApprovalsDirPath(projectRoot),
    getLogsDirPath(projectRoot),
    getCacheDirPath(projectRoot),
    getChatsDirPath(projectRoot),
    path.join(getShipDirPath(projectRoot), 'public'),
    getMcpDirPath(projectRoot),
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

  // Create sample task file
  const sampleTaskPath = path.join(getTasksDirPath(projectRoot), 'sample-task.md');
  const notify = response.integration && response.integration !== 'none' ? response.integration : undefined;
  const sampleTaskContent = `---
id: sample-task
name: Sample Task
cron: "0 9 * * *"
---

This is a sample task.

Please scan the repository for TODO comments and generate a report.
`;
  const finalSampleTaskContent = notify
    ? sampleTaskContent.replace('---\n\n', `notify: ${notify}\n---\n\n`)
    : sampleTaskContent;
  await fs.writeFile(sampleTaskPath, finalSampleTaskContent);
  console.log(`✅ Created sample task file`);

  // Create default mcp.json file in .ship/mcp/ directory
  const mcpDirPath = getMcpDirPath(projectRoot);
  const mcpSchemaPath = path.join(mcpDirPath, 'mcp.schema.json');
  const mcpJsonPath = path.join(mcpDirPath, 'mcp.json');
  await saveJson(mcpSchemaPath, MCP_JSON_SCHEMA);
  await saveJson(mcpJsonPath, { $schema: './mcp.schema.json', servers: {} });
  console.log(`✅ Created .ship/mcp/mcp.json (MCP configuration)`);

  console.log('\n🎉 Initialization complete!\n');
  console.log(`📦 Current model: ${llmConfig.provider} / ${llmConfig.model}`);
  console.log(`🌐 API URL: ${llmConfig.baseUrl}\n`);

  if (response.integration === 'feishu') {
    console.log('📱 Feishu integration enabled');
    console.log('   Please configure FEISHU_APP_ID and FEISHU_APP_SECRET in ship.json');
    console.log('   or set environment variables: FEISHU_APP_ID and FEISHU_APP_SECRET\n');
  } else if (response.integration === 'telegram') {
    console.log('📱 Telegram integration enabled');
    console.log('   Please configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (optional) in ship.json');
    console.log('   or set environment variables: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID\n');
  } else if (response.integration === 'qq') {
    console.log('📱 QQ integration enabled');
    console.log('   Please configure QQ_APP_ID and QQ_APP_SECRET in ship.json');
    console.log('   or set environment variables: QQ_APP_ID and QQ_APP_SECRET\n');
    console.log('   Optional: set QQ_SANDBOX=true to use sandbox environment\n');
  }

  console.log('Next steps:');
  console.log('  1. Edit Agent.md to customize agent behavior');
  console.log('  2. Edit ship.json to modify LLM configuration (baseUrl, apiKey, temperature, etc.)');
  console.log('  3. (Optional) Edit .ship/mcp/mcp.json to configure MCP servers for extended capabilities');
  if (response.integration === 'feishu') {
    console.log('  4. Configure Feishu App ID and App Secret');
    console.log('  5. Run "shipmyagent start" to start the agent\n');
  } else if (response.integration === 'telegram') {
    console.log('  4. Configure Telegram Bot Token and Chat ID (optional)');
    console.log('  5. Run "shipmyagent start" to start the agent\n');
  } else if (response.integration === 'qq') {
    console.log('  4. Configure QQ App ID and App Secret');
    console.log('  5. Run "shipmyagent start" to start the agent\n');
  } else {
    console.log('  4. Run "shipmyagent start" to start the agent\n');
  }
  console.log('💡 Tip: API Key is recommended to use environment variables (e.g. ${ANTHROPIC_API_KEY} or ${OPENAI_API_KEY})\n');
  console.log('🔌 MCP Support: Configure MCP servers in .ship/mcp/mcp.json to connect to databases, APIs, and more');
  console.log('   Learn more: https://modelcontextprotocol.io\n');
  console.log('To switch models or modify configuration, edit the llm field in ship.json directly.\n');
}
