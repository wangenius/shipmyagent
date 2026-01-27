#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';

const program = new Command();

program
  .name('shipmyagent')
  .description('把一个代码仓库，启动成一个可对话、可调度、可审计的 Agent Runtime')
  .version('1.0.0');

// 初始化命令
program
  .command('init [path]')
  .description('初始化 ShipMyAgent 项目')
  .action(initCommand);

// 启动命令
program
  .command('start [path]')
  .description('启动 Agent Runtime')
  .option('-p, --port <port>', '服务端口', '3000')
  .option('-h, --host <host>', '服务主机', '0.0.0.0')
  .action(startCommand);

// 默认启动当前目录
program.parse();
