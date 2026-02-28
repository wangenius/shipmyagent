#!/usr/bin/env node

/**
 * CLI 程序入口模块。
 *
 * 职责说明：
 * 1. 组装所有一级命令（init/run/start/stop/restart/alias/services）。
 * 2. 统一处理命令行参数解析规则（端口、布尔值）。
 * 3. 处理默认命令回退：未指定已知一级命令时自动转发到 run。
 */
import { readFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import { aliasCommand } from "./alias.js";
import { initCommand } from "./init.js";
import { restartCommand } from "./restart.js";
import { runCommand } from "./run.js";
import { registerServicesCommand } from "./services.js";
import { startCommand } from "./start.js";
import { stopCommand } from "./stop.js";
import {
  getServiceRootCommandNames,
  registerAllServicesForCli,
} from "../../core/services/registry.js";

// 在 ES 模块中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 package.json 版本号
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../../../package.json"), "utf-8"),
) as { version: string };

const program = new Command();

function parsePort(value: string): number {
  const num = Number.parseInt(value, 10);
  if (
    !Number.isFinite(num) ||
    Number.isNaN(num) ||
    !Number.isInteger(num) ||
    num <= 0 ||
    num > 65535
  ) {
    throw new Error(`Invalid port: ${value}`);
  }
  return num;
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined) return true;
  const s = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off"].includes(s)) return false;
  throw new Error(`Invalid boolean: ${value}`);
}

program
  .name(basename(process.argv[1] || "shipmyagent"))
  .description("把一个代码仓库，启动为一个拥有自主意识和执行能力的 Agent")
  .version(packageJson.version, "-v, --version");

// 保留 -h 给 host 参数，帮助命令只使用 --help
program.helpOption("--help", "display help for command");

const init = program
  .command("init [path]")
  .description("初始化 ShipMyAgent 项目")
  .helpOption("--help", "display help for command")
  .action(initCommand);

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

const stop = program
  .command("stop [path]")
  .description("停止后台 Agent 服务器（daemon）")
  .helpOption("--help", "display help for command")
  .action(stopCommand);

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

program
  .command("alias")
  .description("在 .zshrc / .bashrc 中写入 `alias sma=\"shipmyagent\"`")
  .option("--shell <shell>", "指定写入的 shell: zsh | bash | both", "both")
  .option("--dry-run", "只打印将要修改的文件，不实际写入", false)
  .option("--print", "仅打印 alias 内容（用于 eval）", false)
  .helpOption("--help", "display help for command")
  .action(aliasCommand);

registerServicesCommand(program);

// 服务命令统一注册（chat / skill / task / future services）
registerAllServicesForCli(program);

// 默认行为：`shipmyagent` / `shipmyagent .` / `shipmyagent [run-options]` -> `shipmyagent run [path]`
const firstArg = process.argv[2];
const staticRootCommands = [
  init.name(),
  run.name(),
  start.name(),
  stop.name(),
  restart.name(),
  "alias",
  "services",
  "help",
];
const serviceRootCommands = getServiceRootCommandNames();
const knownRootCommands = new Set([...staticRootCommands, ...serviceRootCommands]);

if (
  !firstArg ||
  (!knownRootCommands.has(firstArg) &&
    !["--help", "-v", "--version"].includes(firstArg))
) {
  process.argv.splice(2, 0, "run");
}

program.parse();
