#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args[0] || 'help';

const binPath = path.join(__dirname, 'start.js');

async function main() {
  switch (command) {
    case 'init':
    case 'start':
      const child = spawn('node', [path.join(__dirname, 'cli.js'), ...args], {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
      
      child.on('error', (error) => {
        console.error('启动失败:', error);
        process.exit(1);
      });
      
      child.on('exit', (code) => {
        process.exit(code || 0);
      });
      break;
      
    case '--help':
    case '-h':
    case 'help':
      console.log(`
ShipMyAgent - 把一个代码仓库，启动成一个可对话、可调度、可审计的 Agent Runtime

用法:
  shipmyagent [命令] [选项]

命令:
  init [path]     初始化 ShipMyAgent 项目
  start [path]    启动 Agent Runtime

选项:
  -p, --port <port>   服务端口 (默认: 3000)
  -h, --host <host>   服务主机 (默认: 0.0.0.0)
  --help              显示帮助信息

示例:
  shipmyagent init           # 初始化当前目录
  shipmyagent start          # 启动 Agent
  shipmyagent start -p 8080  # 启动并指定端口
`);
      break;
      
    default:
      console.log(`未知命令: ${command}`);
      console.log('使用 --help 查看帮助');
      process.exit(1);
  }
}

main();
