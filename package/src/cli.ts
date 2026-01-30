#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { readFileSync } from "fs";
import { join, dirname, basename } from "path";
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
  .name(basename(process.argv[1] || "shipmyagent"))
  .description(
    "把一个代码仓库，启动成一个可对话、可调度、可审计的 Agent Runtime",
  )
  .version(packageJson.version);

// Init command
program
  .command("init [path]")
  .description("初始化 ShipMyAgent 项目")
  .action(initCommand);

// Start command
program
  .command("start [path]")
  .description("启动 Agent Runtime")
  .option("-p, --port <port>", "服务端口", "3000")
  .option("-h, --host <host>", "服务主机", "0.0.0.0")
  .option("--interactive-web", "启动交互式 Web 界面", false)
  .option("--interactive-port <port>", "交互式 Web 界面端口", "3001")
  .action(startCommand);

// Default: start current directory
program.parse();
