#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { restartCommand } from "./commands/restart.js";
import { aliasCommand } from "./commands/alias.js";
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
    "把一个代码仓库，启动为一个拥有自主意识和执行能力的 Agent",
  )
  .version(packageJson.version, "-v, --version");

// Avoid -h (reserved for host), use --help only.
program.helpOption("--help", "display help for command");

// Init command
const init = program
  .command("init [path]")
  .description("初始化 ShipMyAgent 项目")
  .helpOption("--help", "display help for command")
  .action(initCommand);

// Run command (foreground)
const run = program
  .command("run [path]")
  .description("前台启动 Agent Runtime（当前终端运行）")
  .option("-p, --port <port>", "服务端口（可在 ship.json 的 start.port 配置）", parsePort)
  .option("-h, --host <host>", "服务主机（可在 ship.json 的 start.host 配置）")
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
  .helpOption("--help", "display help for command")
  .action(runCommand);

// Start command (daemon)
const start = program
  .command("start [path]")
  .description("后台启动 Agent Runtime（终端退出也保持运行）")
  .option("-p, --port <port>", "服务端口（可在 ship.json 的 start.port 配置）", parsePort)
  .option("-h, --host <host>", "服务主机（可在 ship.json 的 start.host 配置）")
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
  .helpOption("--help", "display help for command")
  .action(startCommand);

// Stop command (daemon)
const stop = program
  .command("stop [path]")
  .description("停止后台 Agent 服务器（daemon）")
  .helpOption("--help", "display help for command")
  .action(stopCommand);

// Restart command (daemon)
const restart = program
  .command("restart [path]")
  .description("重启后台 Agent 服务器（daemon）")
  .option("-p, --port <port>", "服务端口（可在 ship.json 的 start.port 配置）", parsePort)
  .option("-h, --host <host>", "服务主机（可在 ship.json 的 start.host 配置）")
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
  .helpOption("--help", "display help for command")
  .action(restartCommand);

const alias = program
  .command("alias")
  .description("在 .zshrc / .bashrc 中写入 `alias sma=\"shipmyagent\"`")
  .option("--shell <shell>", "指定写入的 shell: zsh | bash | both", "both")
  .option("--dry-run", "只打印将要修改的文件，不实际写入", false)
  .option("--print", "仅打印 alias 内容（用于 eval）", false)
  .helpOption("--help", "display help for command")
  .action(aliasCommand);

// Default: `shipmyagent` / `shipmyagent .` / `shipmyagent [run-options]` => `shipmyagent run [path]`
const firstArg = process.argv[2];
if (
  !firstArg ||
  (![init.name(), run.name(), start.name(), stop.name(), restart.name(), alias.name(), "help"].includes(firstArg) &&
    !["--help", "-v", "--version"].includes(firstArg))
) {
  process.argv.splice(2, 0, "run");
}

program.parse();
