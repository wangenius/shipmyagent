const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const host = args[0];
const command = args.slice(1).join(' ');

if (!host || !command) {
  console.log('Usage: node ssh_exec.js <host> <command>');
  process.exit(1);
}

// Load config
const configPath = path.join(__dirname, '../references/config.json');
let config = { servers: [] };
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

const server = config.servers.find(s => s.name === host || s.host === host) || { host, user: 'root' };

const sshCmd = `ssh -i ${server.key || '~/.ssh/id_rsa'} ${server.user}@${server.host} "${command}"`;

console.log(`Executing: ${sshCmd}`);
exec(sshCmd, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`Stderr: ${stderr}`);
  }
  console.log(stdout);
});
