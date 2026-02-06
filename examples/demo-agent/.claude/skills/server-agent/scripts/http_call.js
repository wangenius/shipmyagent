const https = require('https');
const http = require('http');

const args = process.argv.slice(2);
const url = args[0];
const method = (args[1] || 'GET').toUpperCase();
const data = args[2];

if (!url) {
  console.log('Usage: node http_call.js <url> [method] [data]');
  process.exit(1);
}

const client = url.startsWith('https') ? https : http;
const options = {
  method: method,
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = client.request(url, options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(data);
  });
});

req.on('error', (e) => {
  console.error(`Error: ${e.message}`);
});

if (data && method !== 'GET') {
  req.write(data);
}

req.end();
