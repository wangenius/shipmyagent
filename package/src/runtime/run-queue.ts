import fs from 'fs-extra';
import path from 'path';
import { getQueueDirPath } from '../utils.js';

export async function ensureQueueDirs(projectRoot: string): Promise<void> {
  const base = getQueueDirPath(projectRoot);
  await fs.ensureDir(path.join(base, 'pending'));
  await fs.ensureDir(path.join(base, 'running'));
  await fs.ensureDir(path.join(base, 'done'));
}

export async function enqueueRun(projectRoot: string, runId: string): Promise<void> {
  await ensureQueueDirs(projectRoot);
  const tokenPath = path.join(getQueueDirPath(projectRoot), 'pending', `${runId}.json`);
  if (await fs.pathExists(tokenPath)) return;
  await fs.writeJson(tokenPath, { runId, enqueuedAt: Date.now() }, { spaces: 2 });
}

export async function tryClaimRun(projectRoot: string, runId: string): Promise<boolean> {
  await ensureQueueDirs(projectRoot);
  const base = getQueueDirPath(projectRoot);
  const from = path.join(base, 'pending', `${runId}.json`);
  const to = path.join(base, 'running', `${runId}.json`);
  if (!(await fs.pathExists(from))) return false;
  try {
    await fs.move(from, to, { overwrite: false });
    return true;
  } catch {
    return false;
  }
}

export async function markRunDone(projectRoot: string, runId: string): Promise<void> {
  await ensureQueueDirs(projectRoot);
  const base = getQueueDirPath(projectRoot);
  const from = path.join(base, 'running', `${runId}.json`);
  const to = path.join(base, 'done', `${runId}.json`);
  try {
    if (await fs.pathExists(from)) {
      await fs.move(from, to, { overwrite: true });
    }
  } catch {
    // ignore
  }
}

export async function listPendingRuns(projectRoot: string): Promise<string[]> {
  await ensureQueueDirs(projectRoot);
  const dir = path.join(getQueueDirPath(projectRoot), 'pending');
  const files = await fs.readdir(dir);
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

