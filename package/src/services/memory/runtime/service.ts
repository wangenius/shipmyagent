import type { ServiceContextStore } from "../../../process/runtime/types/service-runtime-ports.js";
import type { ServiceRuntimeDependencies } from "../../../process/runtime/types/service-runtime-types.js";
import { getLogger } from "../../../utils/logger/logger.js";
import { getServiceModelFactory } from "../../../process/runtime/service-runtime-dependencies.js";
import { MemoryManager } from "./manager.js";
import { compressMemory, extractMemoryFromContextMessages } from "./extractor.js";

const memoryManagers: Map<string, MemoryManager> = new Map();

function getMemoryManager(
  context: ServiceRuntimeDependencies,
  contextId: string,
): MemoryManager {
  const key = String(contextId || "").trim();
  if (!key) {
    throw new Error("Memory service requires a non-empty contextId");
  }
  const cacheKey = `${context.rootPath}::${key}`;
  const existing = memoryManagers.get(cacheKey);
  if (existing) return existing;
  const created = new MemoryManager(context, key);
  memoryManagers.set(cacheKey, created);
  return created;
}

/**
 * runContextMemoryMaintenance：按配置执行 context 记忆维护。
 *
 * 关键点（中文）
 * - 这是 service 侧能力，不属于 core context 内核
 * - core 只在“消息追加后”触发，不关心具体提取/压缩细节
 */
export async function runContextMemoryMaintenance(params: {
  context: ServiceRuntimeDependencies;
  contextId: string;
  getContextStore: (contextId: string) => ServiceContextStore;
}): Promise<void> {
  const contextId = String(params.contextId || "").trim();
  if (!contextId) return;

  const context = params.context;
  const config = context.config?.context?.memory;
  const enabled = config?.autoExtractEnabled ?? true;
  if (!enabled) return;

  const extractMinEntries = config?.extractMinEntries ?? 40;

  try {
    const store = params.getContextStore(contextId);
    const totalEntries = await store.getTotalMessageCount();

    const memoryManager = getMemoryManager(context, contextId);
    const meta = await memoryManager.loadMeta();
    const lastMemorizedEntryCount = meta.lastMemorizedEntryCount ?? 0;
    const unmemorizedCount = totalEntries - lastMemorizedEntryCount;

    if (unmemorizedCount < extractMinEntries) return;

    void extractAndSaveMemory({
      context,
      contextId,
      startIndex: lastMemorizedEntryCount,
      endIndex: totalEntries,
    });
  } catch {
    return;
  }
}

async function extractAndSaveMemory(params: {
  context: ServiceRuntimeDependencies;
  contextId: string;
  startIndex: number;
  endIndex: number;
}): Promise<void> {
  const { context, contextId, startIndex, endIndex } = params;
  const logger = getLogger(context.rootPath, "info");

  try {
    await logger.log("info", "Memory extraction started (async)", {
      contextId,
      entryRange: [startIndex, endIndex],
    });

    const model = await getServiceModelFactory(context).createModel({
      config: context.config,
    });

    const memoryEntry = await extractMemoryFromContextMessages({
      context,
      contextId,
      entryRange: [startIndex, endIndex],
      model,
    });

    const memoryManager = getMemoryManager(context, contextId);
    await memoryManager.append(memoryEntry);

    const meta = await memoryManager.loadMeta();
    await memoryManager.saveMeta({
      lastMemorizedEntryCount: endIndex,
      totalExtractions: (meta.totalExtractions ?? 0) + 1,
      lastExtractedAt: Date.now(),
    });

    await checkAndCompressMemory(context, contextId, model);

    await logger.log("info", "Memory extraction completed (async)", {
      contextId,
      entryRange: [startIndex, endIndex],
    });
  } catch (error) {
    await logger.log("error", "Memory extraction failed (async)", {
      contextId,
      error: String(error),
    });
  }
}

async function checkAndCompressMemory(
  context: ServiceRuntimeDependencies,
  contextId: string,
  model: any,
): Promise<void> {
  const logger = getLogger(context.rootPath, "info");

  try {
    const config = context.config?.context?.memory;
    const compressEnabled = config?.compressOnOverflow ?? true;
    if (!compressEnabled) return;

    const maxChars = config?.maxPrimaryChars ?? 15000;
    const memoryManager = getMemoryManager(context, contextId);
    const currentSize = await memoryManager.getSize();

    if (currentSize <= maxChars) return;

    await logger.log("info", "Memory compression started (async)", {
      contextId,
      currentSize,
      maxChars,
    });

    const backupEnabled = config?.backupBeforeCompress ?? true;
    if (backupEnabled) {
      const backupPath = await memoryManager.backup();
      await logger.log("info", "Memory backed up before compression", {
        contextId,
        backupPath,
      });
    }

    const currentContent = await memoryManager.load();
    const targetChars = Math.floor(maxChars * 0.8);
    const compressed = await compressMemory({
      context,
      contextId,
      currentContent,
      targetChars,
      model,
    });

    await memoryManager.overwrite(compressed);

    await logger.log("info", "Memory compression completed (async)", {
      contextId,
      originalSize: currentSize,
      compressedSize: compressed.length,
      targetChars,
    });
  } catch (error) {
    await logger.log("error", "Memory compression failed (async)", {
      contextId,
      error: String(error),
    });
  }
}
