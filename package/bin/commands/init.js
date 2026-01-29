import path from 'path';
import prompts from 'prompts';
import fs from 'fs-extra';
import { getAgentMdPath, getShipJsonPath, getShipDirPath, getTasksDirPath, getRoutesDirPath, getApprovalsDirPath, getLogsDirPath, getCacheDirPath, ensureDir, saveJson, DEFAULT_SHIP_JSON, MODEL_CONFIGS, } from '../utils.js';
export async function initCommand(cwd = '.', options = {}) {
    const projectRoot = path.resolve(cwd);
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
            ],
            initial: 0,
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
    const modelTemplate = MODEL_CONFIGS[selectedModel] || MODEL_CONFIGS.custom;
    const llmConfig = {
        provider: modelTemplate.provider,
        model: selectedModel, // Use selector value directly as model name
        baseUrl: modelTemplate.baseUrl,
        apiKey: '${API_KEY}',
        temperature: 0.7,
        maxTokens: 4096,
    };
    const shipConfig = {
        name: response.name || path.basename(projectRoot),
        version: '1.0.0',
        llm: llmConfig,
        permissions: DEFAULT_SHIP_JSON.permissions,
        integrations: {
            telegram: {
                enabled: response.integration === 'telegram',
                botToken: response.integration === 'telegram' ? '${TELEGRAM_BOT_TOKEN}' : undefined,
                chatId: response.integration === 'telegram' ? '${TELEGRAM_CHAT_ID}' : undefined,
            },
            feishu: {
                enabled: response.integration === 'feishu',
                appId: response.integration === 'feishu' ? '${FEISHU_APP_ID}' : undefined,
                appSecret: response.integration === 'feishu' ? '${FEISHU_APP_SECRET}' : undefined,
                domain: 'https://open.feishu.cn',
            },
        },
    };
    await saveJson(shipJsonPath, shipConfig);
    console.log(`✅ Created ship.json`);
    // Create .ship directory structure
    const dirs = [
        getShipDirPath(projectRoot),
        getTasksDirPath(projectRoot),
        getRoutesDirPath(projectRoot),
        getApprovalsDirPath(projectRoot),
        getLogsDirPath(projectRoot),
        getCacheDirPath(projectRoot),
    ];
    for (const dir of dirs) {
        await ensureDir(dir);
    }
    console.log(`✅ Created .ship/ directory structure`);
    // Create sample task file
    const sampleTaskPath = path.join(getTasksDirPath(projectRoot), 'sample-task.md');
    const sampleTaskContent = `---
id: sample-task
name: Sample Task
cron: "0 9 * * *"
notify: telegram
---

This is a sample task.

Please scan the repository for TODO comments and generate a report.
`;
    await fs.writeFile(sampleTaskPath, sampleTaskContent);
    console.log(`✅ Created sample task file`);
    console.log('\n🎉 Initialization complete!\n');
    console.log(`📦 Current model: ${llmConfig.provider} / ${llmConfig.model}`);
    console.log(`🌐 API URL: ${llmConfig.baseUrl}\n`);
    if (response.integration === 'feishu') {
        console.log('📱 Feishu integration enabled');
        console.log('   Please configure FEISHU_APP_ID and FEISHU_APP_SECRET in ship.json');
        console.log('   or set environment variables: FEISHU_APP_ID and FEISHU_APP_SECRET\n');
    }
    else if (response.integration === 'telegram') {
        console.log('📱 Telegram integration enabled');
        console.log('   Please configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (optional) in ship.json');
        console.log('   or set environment variables: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID\n');
    }
    console.log('Next steps:');
    console.log('  1. Edit Agent.md to customize agent behavior');
    console.log('  2. Edit ship.json to modify LLM configuration (baseUrl, apiKey, temperature, etc.)');
    if (response.integration === 'feishu') {
        console.log('  3. Configure Feishu App ID and App Secret');
        console.log('  4. Run "shipmyagent start" to start the agent\n');
    }
    else if (response.integration === 'telegram') {
        console.log('  3. Configure Telegram Bot Token and Chat ID (optional)');
        console.log('  4. Run "shipmyagent start" to start the agent\n');
    }
    else {
        console.log('  3. Run "shipmyagent start" to start the agent\n');
    }
    console.log('💡 Tip: API Key is recommended to use environment variables (e.g. ${ANTHROPIC_API_KEY} or ${OPENAI_API_KEY})\n');
    console.log('To switch models or modify configuration, edit the llm field in ship.json directly.\n');
}
//# sourceMappingURL=init.js.map