#!/usr/bin/env node
'use strict';

/**
 * Submit a MinerU-2.5 (302.ai) PDF extraction task by URL, poll for completion,
 * then download and unzip the full output ZIP.
 *
 * Requirements:
 * - Node.js 18+ (global `fetch`)
 * - `unzip` CLI available (optional; if missing, ZIP will still be downloaded)
 *
 * Usage:
 * - `MINERU_API_KEY=... node scripts/mineru_extract_url.cjs --url https://.../file.pdf`
 *
 * Options:
 * - `--url <pdfUrl>` (required) PDF URL reachable by 302.ai
 * - `--out <dir>` (optional) output directory; default: `<projectRoot>/.ship/downloads`
 * - `--base-url <url>` (optional) default: https://api.302.ai
 * - `--api-key <key>` (optional) fallback: MINERU_API_KEY env
 * - `--model-version <v>` (optional) default: mineru-2.5
 * - `--enable-ocr` (optional) include enable_ocr=true in create body
 * - `--poll-ms <n>` (optional) default: 2000
 * - `--timeout-ms <n>` (optional) default: 300000
 * - `--no-download` (optional) skip ZIP download/unzip
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function normalizeBaseUrl(raw) {
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function parseArgs(argv) {
  const args = {
    url: undefined,
    outDir: undefined,
    baseUrl: 'https://api.302.ai',
    apiKey: process.env.MINERU_API_KEY,
    modelVersion: 'mineru-2.5',
    enableOcr: false,
    pollMs: 2000,
    timeoutMs: 300000,
    download: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') {
      args.url = argv[++i];
    } else if (a === '--out') {
      args.outDir = argv[++i];
    } else if (a === '--base-url') {
      args.baseUrl = argv[++i];
    } else if (a === '--api-key') {
      args.apiKey = argv[++i];
    } else if (a === '--model-version') {
      args.modelVersion = argv[++i];
    } else if (a === '--enable-ocr') {
      args.enableOcr = true;
    } else if (a === '--poll-ms') {
      args.pollMs = Number(argv[++i]);
    } else if (a === '--timeout-ms') {
      args.timeoutMs = Number(argv[++i]);
    } else if (a === '--no-download') {
      args.download = false;
    } else if (a === '--help' || a === '-h') {
      return { ...args, help: true };
    } else {
      die(`Unknown arg: ${a}`);
    }
  }

  args.baseUrl = normalizeBaseUrl(args.baseUrl);
  return args;
}

function pathExistsAsDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findProjectRootWithShip(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (pathExistsAsDir(path.join(current, '.ship'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch (e) {
    throw new Error(`Non-JSON response (${res.status}) from ${url}: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = data && typeof data === 'object' ? JSON.stringify(data) : text;
    throw new Error(`HTTP ${res.status} from ${url}: ${msg}`);
  }
  return data;
}

async function createTask({ baseUrl, apiKey, url, modelVersion, enableOcr }) {
  const body = {
    url,
    model_version: modelVersion,
    full_doc_zip: true,
  };
  if (enableOcr) {
    body.enable_ocr = true;
  }

  const data = await fetchJson(`${baseUrl}/mineru/api/v4/extract/task`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const taskId = data && typeof data === 'object' ? data.task_id : undefined;
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw new Error(`Unexpected create-task response: ${JSON.stringify(data)}`);
  }
  return taskId;
}

async function getTask({ baseUrl, apiKey, taskId }) {
  return fetchJson(`${baseUrl}/mineru/api/v4/extract/task/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalState(state) {
  return state === 'done' || state === 'failed' || state === 'success' || state === 'error';
}

function isSuccessState(state) {
  return state === 'done' || state === 'success';
}

async function waitForTask({ baseUrl, apiKey, taskId, pollMs, timeoutMs }) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await getTask({ baseUrl, apiKey, taskId });
    const state = last && typeof last === 'object' ? last.state : undefined;
    if (typeof state === 'string' && isTerminalState(state)) {
      return last;
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for task ${taskId} after ${timeoutMs}ms. Last: ${JSON.stringify(last)}`);
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp`;

  const file = fs.createWriteStream(tmpPath);
  await new Promise((resolve, reject) => {
    res.body.pipe(file);
    res.body.on('error', reject);
    file.on('finish', resolve);
    file.on('error', reject);
  });
  await fs.promises.rename(tmpPath, outPath);
}

function tryUnzip(zipPath, outDir) {
  const check = spawnSync('unzip', ['-v'], { stdio: 'ignore' });
  if (check.error) {
    return { ok: false, reason: 'unzip_not_found' };
  }

  const r = spawnSync('unzip', ['-o', '-qq', zipPath, '-d', outDir], { stdio: 'ignore' });
  if (r.status !== 0) {
    return { ok: false, reason: `unzip_exit_${r.status}` };
  }
  return { ok: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('See the header comment in scripts/mineru_extract_url.cjs for usage.\n');
    return;
  }

  if (!args.url) {
    die('Missing required --url');
  }
  if (!args.apiKey) {
    die('Missing API key. Provide --api-key or set MINERU_API_KEY.');
  }
  if (!Number.isFinite(args.pollMs) || args.pollMs <= 0) {
    die('--poll-ms must be a positive number');
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    die('--timeout-ms must be a positive number');
  }

  const projectRoot = findProjectRootWithShip(process.cwd());
  const defaultOutDir = projectRoot
    ? path.join(projectRoot, '.ship', 'downloads')
    : path.join(process.cwd(), '.ship', 'downloads');
  const outDir = args.outDir ? path.resolve(args.outDir) : defaultOutDir;

  await fs.promises.mkdir(outDir, { recursive: true });

  const taskId = await createTask({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    url: args.url,
    modelVersion: args.modelVersion,
    enableOcr: args.enableOcr,
  });
  process.stderr.write(`Created task: ${taskId}\n`);

  const task = await waitForTask({
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
    taskId,
    pollMs: args.pollMs,
    timeoutMs: args.timeoutMs,
  });

  const state = task && typeof task === 'object' ? task.state : undefined;
  if (typeof state !== 'string') {
    throw new Error(`Unexpected task response (missing state): ${JSON.stringify(task)}`);
  }
  if (!isSuccessState(state)) {
    const errMsg = task && typeof task === 'object' ? task.err_msg : undefined;
    throw new Error(`Task ${taskId} finished with state=${state}. err_msg=${String(errMsg)}`);
  }

  if (!args.download) {
    process.stdout.write(JSON.stringify({ taskId, state, task }, null, 2));
    process.stdout.write('\n');
    return;
  }

  const fullZipUrl = task && typeof task === 'object' ? task.full_zip_url : undefined;
  if (typeof fullZipUrl !== 'string' || fullZipUrl.length === 0) {
    throw new Error(`Task ${taskId} completed but full_zip_url is missing: ${JSON.stringify(task)}`);
  }

  const zipPath = path.join(outDir, `mineru-${taskId}.zip`);
  process.stderr.write(`Downloading ZIP: ${zipPath}\n`);
  await downloadToFile(fullZipUrl, zipPath);

  const extractDir = path.join(outDir, `mineru-${taskId}`);
  await fs.promises.mkdir(extractDir, { recursive: true });
  const unzipResult = tryUnzip(zipPath, extractDir);

  const result = {
    taskId,
    state,
    outDir,
    zipPath,
    extractDir: unzipResult.ok ? extractDir : null,
    unzip: unzipResult,
    fullZipUrl,
  };
  process.stdout.write(JSON.stringify(result, null, 2));
  process.stdout.write('\n');
}

main().catch((err) => {
  const msg = err && typeof err === 'object' && err.stack ? err.stack : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
