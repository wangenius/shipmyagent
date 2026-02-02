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

const parsePort = (value: string): number => {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || Number.isNaN(num) || !Number.isInteger(num) || num <= 0 || num > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return num;
};

const parseBoolean = (value: string | undefined): boolean => {
  if (value === undefined) return true;
  const s = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off"].includes(s)) return false;
  throw new Error(`Invalid boolean: ${value}`);
};

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
  .option("-p, --port <port>", "服务端口（可在 ship.json 的 start.port 配置）", parsePort)
  .option("-H, --host <host>", "服务主机（可在 ship.json 的 start.host 配置）")
  .option(
    "--interactive-web [enabled]",
    "启动交互式 Web 界面（可在 ship.json 的 start.interactiveWeb 配置）",
    parseBoolean,
  )
  .option(
    "--interactive-port <port>",
    "交互式 Web 界面端口（可在 ship.json 的 start.interactivePort 配置）",
    parsePort,
  )
  .action(startCommand);

// Default: `shipmyagent` / `shipmyagent .` => `shipmyagent start [path]`
const firstArg = process.argv[2];
if (
  !firstArg ||
  (!firstArg.startsWith("-") && firstArg !== "init" && firstArg !== "start" && firstArg !== "help")
) {
  process.argv.splice(2, 0, "start");
}

program.parse();
