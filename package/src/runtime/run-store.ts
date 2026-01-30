import fs from 'fs-extra';
import path from 'path';
import { getRunsDirPath, getTimestamp, generateId } from '../utils.js';
import type { RunRecord, RunTrigger } from './run-types.js';

export function generateRunId(): string {
  // Stable, filesystem-safe id.
  return `run_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}_${generateId()}`;
}

export async function ensureRunsDir(projectRoot: string): Promise<void> {
  await fs.ensureDir(getRunsDirPath(projectRoot));
}

export function getRunPath(projectRoot: string, runId: string): string {
  return path.join(getRunsDirPath(projectRoot), `${runId}.json`);
}

export async function saveRun(projectRoot: string, run: RunRecord): Promise<void> {
  await ensureRunsDir(projectRoot);
  await fs.writeJson(getRunPath(projectRoot, run.runId), run, { spaces: 2 });
}

export async function loadRun(projectRoot: string, runId: string): Promise<RunRecord | null> {
  const p = getRunPath(projectRoot, runId);
  if (!(await fs.pathExists(p))) return null;
  return (await fs.readJson(p)) as RunRecord;
}

export async function listRuns(
  projectRoot: string,
  opts?: { limit?: number; statuses?: RunRecord['status'][] },
): Promise<RunRecord[]> {
  await ensureRunsDir(projectRoot);
  const dir = getRunsDirPath(projectRoot);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));

  const withMtime = await Promise.all(
    files.map(async (f) => {
      const p = path.join(dir, f);
      const st = await fs.stat(p);
      return { f, p, t: st.mtimeMs };
    }),
  );
  withMtime.sort((a, b) => b.t - a.t);

  const limit = typeof opts?.limit === 'number' && opts.limit > 0 ? Math.floor(opts.limit) : 50;
  const statuses = Array.isArray(opts?.statuses) && opts!.statuses.length > 0 ? new Set(opts!.statuses) : null;

  const out: RunRecord[] = [];
  for (const item of withMtime) {
    if (out.length >= limit) break;
    try {
      const run = (await fs.readJson(item.p)) as RunRecord;
      if (statuses && !statuses.has(run.status)) continue;
      out.push(run);
    } catch {
      // ignore corrupted run file
    }
  }

  return out;
}

export async function createRun(params: {
  projectRoot: string;
  trigger: RunTrigger;
  taskId?: string;
  name?: string;
  context?: RunRecord['context'];
  instructions?: string;
}): Promise<RunRecord> {
  const run: RunRecord = {
    runId: generateRunId(),
    taskId: params.taskId,
    name: params.name,
    createdAt: getTimestamp(),
    status: 'queued',
    notified: false,
    trigger: params.trigger,
    context: params.context,
    input: { instructions: params.instructions },
  };
  await saveRun(params.projectRoot, run);
  return run;
}
