import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copy built-in skills assets from `src/` to `bin/`.
 *
 * 关键点（中文）
 * - `tsc` 只编译 .ts/.js，不会复制 `SKILL.md`/assets，所以需要额外 copy
 * - 运行时 built-in roots 是基于 `paths.js` 的 `import.meta.url` 解析出来的 `bin/intergrations/skills/built-in`
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(packageRoot, "src", "intergrations", "skills", "built-in");
const dstRoot = path.join(packageRoot, "bin", "intergrations", "skills", "built-in");

if (!(await fs.pathExists(srcRoot))) {
  console.log("[copy-built-in-skills] skip: no src built-in skills");
  process.exit(0);
}

await fs.ensureDir(path.dirname(dstRoot));
await fs.copy(srcRoot, dstRoot, { overwrite: true, dereference: true });
console.log(`[copy-built-in-skills] copied: ${srcRoot} -> ${dstRoot}`);

