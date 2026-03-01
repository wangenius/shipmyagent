import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy prompt txt assets from `src/core/prompts` to `bin/core/prompts`.
 *
 * 关键点（中文）
 * - `tsc` 不会复制 txt 资源文件，运行时又依赖该文件，必须在 build 后补复制。
 * - 只复制 `.txt`，避免把无关源码带入 `bin`。
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(packageRoot, "src", "core", "prompts");
const dstRoot = path.join(packageRoot, "bin", "core", "prompts");

if (!(await fs.pathExists(srcRoot))) {
  console.log("[copy-prompt-assets] skip: no src/core/prompts directory");
  process.exit(0);
}

const entries = await fs.readdir(srcRoot);
const textAssets = entries.filter((item) => item.endsWith(".txt"));

if (textAssets.length === 0) {
  console.log("[copy-prompt-assets] skip: no .txt assets in core/prompts");
  process.exit(0);
}

await fs.ensureDir(dstRoot);
for (const fileName of textAssets) {
  await fs.copy(path.join(srcRoot, fileName), path.join(dstRoot, fileName), {
    overwrite: true,
    dereference: true,
  });
}

console.log(
  `[copy-prompt-assets] copied ${textAssets.length} file(s): ${srcRoot} -> ${dstRoot}`,
);
