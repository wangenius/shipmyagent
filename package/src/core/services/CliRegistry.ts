/**
 * CLI command registry adapter.
 *
 * 关键点（中文）
 * - 把 commander 的注册细节隔离到一处
 * - 模块只关心“注册命令”，不关心底层库
 */

import type { Command } from "commander";
import type { CliCommandRegistry } from "./ServiceRegistry.js";

class CommanderCliCommandRegistry implements CliCommandRegistry {
  private readonly commandTarget: Command;

  constructor(commandTarget: Command) {
    this.commandTarget = commandTarget;
  }

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

  raw(): Command {
    return this.commandTarget;
  }
}

export function createCliCommandRegistry(program: Command): CliCommandRegistry {
  return new CommanderCliCommandRegistry(program);
}
