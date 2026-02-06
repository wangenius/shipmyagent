const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const local = args[0];
const remote = args[1];
const host = args[2];

if (!local || !remote || !host) {
  console.log('Usage: node sync_files.js <local_path> <remote_path> <host>');
  process.exit(1);
}

const configPath = path.join(__dirname, '../references/config.json');
let config = { servers: [] };
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

const server = config.servers.find(s => s.name === host || s.host === host) || { host, user: 'root' };

const rsyncCmd = `rsync -avz -e "ssh -i ${server.key || '~/.ssh/id_rsa'}" ${local} ${server.user}@${server.host}:${remote}`;

console.log(`Syncing: ${rsyncCmd}`);
exec(rsyncCmd, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error: ${error.message}`);
    return;
  }
  console.log(stdout);
});
