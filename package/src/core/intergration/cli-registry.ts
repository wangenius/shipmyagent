/**
 * CLI command registry adapter.
 *
 * 关键点（中文）
 * - 把 commander 的注册细节隔离到一处
 * - 模块只关心“注册命令”，不关心底层库
 */

import type { Command } from "commander";
import type { CliCommandRegistry } from "./types/module-registry.js";

/**
 * CommanderCliCommandRegistry：commander 的 CliCommandRegistry 适配器。
 *
 * 关键点（中文）
 * - 模块层只依赖抽象接口，便于未来替换 CLI 框架。
 */
class CommanderCliCommandRegistry implements CliCommandRegistry {
  private readonly commandTarget: Command;

  constructor(commandTarget: Command) {
    this.commandTarget = commandTarget;
  }

  /**
   * 注册一个叶子命令。
   *
   * 约束（中文）
   * - 默认统一挂载 `--help`，保证所有模块命令体验一致。
   */
  command(
    name: string,
    description: string,
    configure: (command: Command) => void,
  ): Command {
    const command = this.commandTarget
      .command(name)
      .description(description)
      .helpOption("--help", "display help for command");
    configure(command);
    return command;
  }

  /**
   * 注册一个命令组。
   *
   * 算法（中文）
   * - 先创建组命令，再基于组命令创建子 registry，最后递归配置子命令。
   *
   * 分组价值（中文）
   * - 把命令树结构固定在 adapter 层，模块只表达业务命令关系。
   */
  group(
    name: string,
    description: string,
    configure: (group: CliCommandRegistry, groupCommand: Command) => void,
  ): Command {
    const groupCommand = this.commandTarget
      .command(name)
      .description(description)
      .helpOption("--help", "display help for command");

    const groupRegistry = new CommanderCliCommandRegistry(groupCommand);
    configure(groupRegistry, groupCommand);
    return groupCommand;
  }

  /**
   * 暴露底层 commander 实例。
   */
  raw(): Command {
    return this.commandTarget;
  }
}

/**
 * 创建 CLI command registry。
 */
export function createCliCommandRegistry(program: Command): CliCommandRegistry {
  return new CommanderCliCommandRegistry(program);
}
