#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// 在 ES 模块中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 动态读取版本号
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8")
);

const program = new Command();

program
<<<<<<< HEAD
  .name("shipmyagent")
  .description(
    "把一个代码仓库，启动成一个可对话、可调度、可审计的 Agent Runtime",
  )
  .version(packageJson.version);
=======
  .name('shipmyagent')
  .description('Turn a code repository into a conversational, schedulable, and auditable Agent Runtime')
  .version('1.0.0');
>>>>>>> origin/wzg

// Init command
program
<<<<<<< HEAD
  .command("init [path]")
  .description("初始化 ShipMyAgent 项目")
=======
  .command('init [path]')
  .description('Initialize ShipMyAgent project')
>>>>>>> origin/wzg
  .action(initCommand);

// Start command
program
<<<<<<< HEAD
  .command("start [path]")
  .description("启动 Agent Runtime")
  .option("-p, --port <port>", "服务端口", "3000")
  .option("-h, --host <host>", "服务主机", "0.0.0.0")
  .option("--interactive-web", "启动交互式 Web 界面", false)
  .option("--interactive-port <port>", "交互式 Web 界面端口", "3001")
=======
  .command('start [path]')
  .description('Start Agent Runtime')
  .option('-p, --port <port>', 'Server port', '3000')
  .option('-h, --host <host>', 'Server host', '0.0.0.0')
>>>>>>> origin/wzg
  .action(startCommand);

// Default: start current directory
program.parse();
