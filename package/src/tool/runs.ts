import fs from "fs-extra";
import path from "path";
import { z } from "zod";
import { tool } from "ai";
import { getQueueDirPath, getRunsDirPath, getTimestamp } from "../utils.js";
import { listQueueRuns, listRuns, loadRun, saveRun } from "../runtime/run/index.js";
import type { RunRecord } from "../runtime/run/index.js";
import { getToolRuntimeContext } from "./runtime-context.js";

export const runs_status = tool({
  description:
    "Get background run status from the filesystem (.ship/runs and .ship/queue). Use this to answer questions like: what is running, queued, waiting approval, or recently finished.",
  inputSchema: z.object({
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("How many recent runs to return (default: 10, max: 50)"),
  }),
  execute: async ({ limit }: { limit?: number }) => {
    const { projectRoot } = getToolRuntimeContext();
    const safeLimit =
      typeof limit === "number" ? Math.max(1, Math.min(50, Math.floor(limit))) : 10;

    const runs = (await listRuns(projectRoot, { limit: safeLimit })) as RunRecord[];
    const counts: Record<string, number> = {};
    for (const r of runs) counts[r.status] = (counts[r.status] || 0) + 1;

    const pending = await listQueueRuns(projectRoot, "pending", { limit: safeLimit });
    const running = await listQueueRuns(projectRoot, "running", { limit: safeLimit });
    const pausedPath = path.join(getQueueDirPath(projectRoot), "paused.json");
    const paused = await fs.pathExists(pausedPath);
    const pausedInfo = paused ? await fs.readJson(pausedPath).catch(() => null) : null;

    return {
      success: true,
      summary: {
        runsDir: path.relative(projectRoot, getRunsDirPath(projectRoot)),
        recentCountsByStatus: counts,
        queue: {
          paused,
          pausedInfo,
          pendingCount: pending.length,
          runningCount: running.length,
          pending,
          running,
        },
      },
      runs: runs.map((r) => ({
        runId: r.runId,
        taskId: r.taskId,
        name: r.name,
        status: r.status,
        createdAt: r.createdAt,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        trigger: r.trigger,
        pendingApproval: r.pendingApproval
          ? {
              id: (r.pendingApproval as any)?.id,
              type: (r.pendingApproval as any)?.type,
            }
          : undefined,
        outputPreview: (r.output?.text || r.error?.message || "").slice(0, 400),
      })),
    };
  },
});

export const run_get = tool({
  description:
    "Load a single run record by runId from .ship/runs. Use this when the user asks about a specific run.",
  inputSchema: z.object({
    runId: z.string().describe("Run id, e.g. run_20260130101010_abcd1234"),
  }),
  execute: async ({ runId }: { runId: string }) => {
    const { projectRoot } = getToolRuntimeContext();
    const id = String(runId || "").trim();
    if (!id) return { success: false, error: "Missing runId" };
    const run = (await loadRun(projectRoot, id)) as RunRecord | null;
    if (!run) return { success: false, error: `Run not found: ${id}` };
    return { success: true, run };
  },
});

export const runs_pause = tool({
  description:
    "Pause background run processing (worker will stop picking up new pending runs). This does not kill an in-progress run.",
  inputSchema: z.object({
    reason: z.string().optional().describe("Optional reason for pausing"),
  }),
  execute: async ({ reason }: { reason?: string }) => {
    const { projectRoot } = getToolRuntimeContext();
    const queueDir = getQueueDirPath(projectRoot);
    await fs.ensureDir(queueDir);
    const pausedPath = path.join(queueDir, "paused.json");
    const payload = {
      paused: true,
      pausedAt: getTimestamp(),
      reason: typeof reason === "string" ? reason.slice(0, 500) : undefined,
    };
    await fs.writeJson(pausedPath, payload, { spaces: 2 });
    return { success: true, pausedPath: path.relative(projectRoot, pausedPath), ...payload };
  },
});

export const runs_resume = tool({
  description: "Resume background run processing (unpause the worker).",
  inputSchema: z.object({}),
  execute: async () => {
    const { projectRoot } = getToolRuntimeContext();
    const queueDir = getQueueDirPath(projectRoot);
    const pausedPath = path.join(queueDir, "paused.json");
    if (await fs.pathExists(pausedPath)) await fs.remove(pausedPath);
    return { success: true, paused: false };
  },
});

export const run_cancel = tool({
  description:
    "Cancel a background run by runId. If the run is pending it will not execute. If it's already running, cancellation is best-effort (it may finish anyway).",
  inputSchema: z.object({
    runId: z.string().describe("Run id to cancel"),
    reason: z.string().optional().describe("Optional cancellation reason"),
  }),
  execute: async ({ runId, reason }: { runId: string; reason?: string }) => {
    const { projectRoot } = getToolRuntimeContext();
    const id = String(runId || "").trim();
    if (!id) return { success: false, error: "Missing runId" };

    const run = (await loadRun(projectRoot, id)) as RunRecord | null;
    if (!run) return { success: false, error: `Run not found: ${id}` };

    if (run.status === "succeeded" || run.status === "failed" || run.status === "canceled") {
      return { success: true, runId: id, status: run.status, note: "No-op (already finished)" };
    }

    run.status = "canceled";
    run.finishedAt = getTimestamp();
    run.error = { message: `Canceled${reason ? `: ${String(reason).slice(0, 500)}` : ""}` };
    run.pendingApproval = undefined;
    await saveRun(projectRoot, run);

    const queueDir = getQueueDirPath(projectRoot);
    const pendingToken = path.join(queueDir, "pending", `${id}.json`);
    const runningToken = path.join(queueDir, "running", `${id}.json`);
    const doneToken = path.join(queueDir, "done", `${id}.json`);
    await fs.ensureDir(path.join(queueDir, "done"));

    if (await fs.pathExists(pendingToken)) {
      try {
        await fs.move(pendingToken, doneToken, { overwrite: true });
      } catch {
        await fs.remove(pendingToken);
      }
    }
    if (await fs.pathExists(runningToken)) {
      try {
        await fs.move(runningToken, doneToken, { overwrite: true });
      } catch {
        await fs.remove(runningToken);
      }
    }

    return { success: true, runId: id, status: run.status };
  },
});

export const runTools = { runs_status, run_get, runs_pause, runs_resume, run_cancel };
