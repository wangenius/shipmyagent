#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
const program = new Command();
program
    .name('shipmyagent')
    .description('Turn a code repository into a conversational, schedulable, and auditable Agent Runtime')
    .version('1.0.0');
// Init command
program
    .command('init [path]')
    .description('Initialize ShipMyAgent project')
    .action(initCommand);
// Start command
program
    .command('start [path]')
    .description('Start Agent Runtime')
    .option('-p, --port <port>', 'Server port', '3000')
    .option('-h, --host <host>', 'Server host', '0.0.0.0')
    .action(startCommand);
// Default: start current directory
program.parse();
//# sourceMappingURL=cli.js.map