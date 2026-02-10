import { createModel } from "../../../core/llm/create-model.js";
import type { SessionHistoryStore } from "../../../core/session/history-store.js";
import { getLogger } from "../../../telemetry/index.js";
import { getShipRuntimeContext } from "../../../server/ShipRuntimeContext.js";
import { MemoryManager } from "./manager.js";
import { compressMemory, extractMemoryFromHistory } from "./extractor.js";

const memoryManagers: Map<string, MemoryManager> = new Map();

function getMemoryManager(sessionId: string): MemoryManager {
  const key = String(sessionId || "").trim();
  if (!key) {
    throw new Error("Memory service requires a non-empty sessionId");
  }
  const existing = memoryManagers.get(key);
  if (existing) return existing;
  const created = new MemoryManager(key);
  memoryManagers.set(key, created);
  return created;
}

/**
 * runSessionMemoryMaintenance：按配置执行 session 记忆维护。
 *
 * 关键点（中文）
 * - 这是 integration 侧能力，不属于 core session 内核
 * - core 只在“消息追加后”触发，不关心具体提取/压缩细节
 */
export async function runSessionMemoryMaintenance(params: {
  sessionId: string;
  getHistoryStore: (sessionId: string) => SessionHistoryStore;
}): Promise<void> {
  const sessionId = String(params.sessionId || "").trim();
  if (!sessionId) return;

  const runtime = getShipRuntimeContext();
  const config = runtime.config?.context?.memory;
  const enabled = config?.autoExtractEnabled ?? true;
  if (!enabled) return;

  const extractMinEntries = config?.extractMinEntries ?? 40;

  try {
    const store = params.getHistoryStore(sessionId);
    const totalEntries = await store.getTotalMessageCount();

    const memoryManager = getMemoryManager(sessionId);
    const meta = await memoryManager.loadMeta();
    const lastMemorizedEntryCount = meta.lastMemorizedEntryCount ?? 0;
    const unmemorizedCount = totalEntries - lastMemorizedEntryCount;

    if (unmemorizedCount < extractMinEntries) return;

    void extractAndSaveMemory({
      sessionId,
      startIndex: lastMemorizedEntryCount,
      endIndex: totalEntries,
    });
  } catch {
    return;
  }
}

async function extractAndSaveMemory(params: {
  sessionId: string;
  startIndex: number;
  endIndex: number;
}): Promise<void> {
  const { sessionId, startIndex, endIndex } = params;
  const runtime = getShipRuntimeContext();
  const logger = getLogger(runtime.rootPath, "info");

  try {
    await logger.log("info", "Memory extraction started (async)", {
      sessionId,
      entryRange: [startIndex, endIndex],
    });

    const model = await createModel({ config: runtime.config });

    const memoryEntry = await extractMemoryFromHistory({
      sessionId,
      entryRange: [startIndex, endIndex],
      model,
    });

    const memoryManager = getMemoryManager(sessionId);
    await memoryManager.append(memoryEntry);

    const meta = await memoryManager.loadMeta();
    await memoryManager.saveMeta({
      lastMemorizedEntryCount: endIndex,
      totalExtractions: (meta.totalExtractions ?? 0) + 1,
      lastExtractedAt: Date.now(),
    });

    await checkAndCompressMemory(sessionId, model);

    await logger.log("info", "Memory extraction completed (async)", {
      sessionId,
      entryRange: [startIndex, endIndex],
    });
  } catch (error) {
    await logger.log("error", "Memory extraction failed (async)", {
      sessionId,
      error: String(error),
    });
  }
}

async function checkAndCompressMemory(
  sessionId: string,
  model: any,
): Promise<void> {
  const runtime = getShipRuntimeContext();
  const logger = getLogger(runtime.rootPath, "info");

  try {
    const config = runtime.config?.context?.memory;
    const compressEnabled = config?.compressOnOverflow ?? true;
    if (!compressEnabled) return;

    const maxChars = config?.maxPrimaryChars ?? 15000;
    const memoryManager = getMemoryManager(sessionId);
    const currentSize = await memoryManager.getSize();

    if (currentSize <= maxChars) return;

    await logger.log("info", "Memory compression started (async)", {
      sessionId,
      currentSize,
      maxChars,
    });

    const backupEnabled = config?.backupBeforeCompress ?? true;
    if (backupEnabled) {
      const backupPath = await memoryManager.backup();
      await logger.log("info", "Memory backed up before compression", {
        sessionId,
        backupPath,
      });
    }

    const currentContent = await memoryManager.load();
    const targetChars = Math.floor(maxChars * 0.8);
    const compressed = await compressMemory({
      sessionId,
      currentContent,
      targetChars,
      model,
    });

    await memoryManager.overwrite(compressed);

    await logger.log("info", "Memory compression completed (async)", {
      sessionId,
      originalSize: currentSize,
      compressedSize: compressed.length,
      targetChars,
    });
  } catch (error) {
    await logger.log("error", "Memory compression failed (async)", {
      sessionId,
      error: String(error),
    });
  }
}
