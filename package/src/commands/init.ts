import path from 'path';
import prompts from 'prompts';
import fs from 'fs-extra';
import {
  getAgentMdPath,
  getShipJsonPath,
  getShipDirPath,
  getTasksDirPath,
  getRoutesDirPath,
  getApprovalsDirPath,
  getLogsDirPath,
  getCacheDirPath,
  ensureDir,
  saveJson,
  DEFAULT_SHIP_JSON,
  MODEL_CONFIGS,
  ShipConfig,
} from '../utils.js';

interface InitOptions {
  force?: boolean;
}

export async function initCommand(cwd: string = '.', options: InitOptions = {}): Promise<void> {
  const projectRoot = path.resolve(cwd);

  console.log(`🚀 初始化 ShipMyAgent 项目: ${projectRoot}`);

  // 检查是否已存在 Agent.md 和 ship.json
  const existingAgentMd = fs.existsSync(getAgentMdPath(projectRoot));
  const existingShipJson = fs.existsSync(getShipJsonPath(projectRoot));

  if (existingAgentMd || existingShipJson) {
    if (!options.force) {
      const response = await prompts({
        type: 'confirm',
        name: 'overwrite',
        message: '项目已初始化，是否覆盖现有配置？',
        initial: false,
      });

      if (!response.overwrite) {
        console.log('❌ 已取消初始化');
        return;
      }
    }
  }

  // 收集配置信息
  const response = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Agent 名称',
      initial: path.basename(projectRoot),
    },
    {
      type: 'select',
      name: 'model',
      message: '选择 LLM 模型',
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
        { title: '自定义模型', value: 'custom' },
      ],
      initial: 0,
    },
    {
      type: 'select',
      name: 'integration',
      message: '选择消息集成方式',
      choices: [
        { title: '不启用', value: 'none' },
        { title: 'Telegram', value: 'telegram' },
        { title: '飞书', value: 'feishu' },
      ],
      initial: 0,
    },
  ]);

  // 创建配置文件
  const agentMdPath = getAgentMdPath(projectRoot);
  const shipJsonPath = getShipJsonPath(projectRoot);

  // 保存 Agent.md（默认的用户身份定义）
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
  console.log(`✅ 创建 Agent.md`);

  // 保存 ship.json
  // 构建 LLM 配置
  const selectedModel = response.model || 'claude-sonnet-4-5';
  const modelTemplate = MODEL_CONFIGS[selectedModel as keyof typeof MODEL_CONFIGS] || MODEL_CONFIGS.custom;

  const llmConfig = {
    provider: modelTemplate.provider,
    model: selectedModel, // 直接使用选择器值作为模型名称
    baseUrl: modelTemplate.baseUrl,
    apiKey: '${API_KEY}',
    temperature: 0.7,
    maxTokens: 4096,
  };

  const shipConfig: ShipConfig = {
    name: response.name || path.basename(projectRoot),
    version: '1.0.0',
    llm: llmConfig,
    permissions: DEFAULT_SHIP_JSON.permissions,
    integrations: {
      telegram: {
        enabled: response.integration === 'telegram',
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
  console.log(`✅ 创建 ship.json`);

  // 创建 .ship 目录结构
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
  console.log(`✅ 创建 .ship/ 目录结构`);

  // 创建示例任务文件
  const sampleTaskPath = path.join(getTasksDirPath(projectRoot), 'sample-task.md');
  const sampleTaskContent = `---
id: sample-task
name: 示例任务
cron: "0 9 * * *"
notify: telegram
---

这是一个示例任务。

请扫描仓库中的 TODO 注释并生成报告。
`;
  await fs.writeFile(sampleTaskPath, sampleTaskContent);
  console.log(`✅ 创建示例任务文件`);

  console.log('\n🎉 初始化完成！\n');
  console.log(`📦 当前模型: ${llmConfig.provider} / ${llmConfig.model}`);
  console.log(`🌐 API URL: ${llmConfig.baseUrl}\n`);

  if (response.integration === 'feishu') {
    console.log('📱 飞书集成已启用');
    console.log('   请在 ship.json 中配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET');
    console.log('   或设置环境变量: FEISHU_APP_ID 和 FEISHU_APP_SECRET\n');
  } else if (response.integration === 'telegram') {
    console.log('📱 Telegram 集成已启用');
    console.log('   请在 ship.json 中配置 botToken\n');
  }

  console.log('下一步：');
  console.log('  1. 编辑 Agent.md 自定义 Agent 行为');
  console.log('  2. 编辑 ship.json 修改 LLM 配置（baseUrl、apiKey、temperature 等）');
  if (response.integration === 'feishu') {
    console.log('  3. 配置飞书 App ID 和 App Secret');
    console.log('  4. 运行 "shipmyagent start" 启动 Agent\n');
  } else {
    console.log('  3. 运行 "shipmyagent start" 启动 Agent\n');
  }
  console.log('💡 提示：API Key 建议使用环境变量（如 ${ANTHROPIC_API_KEY} 或 ${OPENAI_API_KEY}）\n');
  console.log('如需切换模型或修改配置，直接编辑 ship.json 中的 llm 字段即可。\n');
}
