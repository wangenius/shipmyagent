import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Import 边界检查。
 *
 * 关键点（中文）
 * - 限制 integrations 层对 core/server 的反向依赖
 * - 限制 integration module 入口对 core/server 的直接依赖
 * - 限制 integrations 之间的横向直接依赖（仅允许 shared/runtime）
 * - 以脚本方式落地，避免引入额外 lint 工具链
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(packageRoot, "src");
const integrationsRoot = path.join(srcRoot, "intergrations");

const IMPORT_RE =
  /(?:import\s+[^"'`]*?from\s*|export\s+[^"'`]*?from\s*|import\s*\()\s*["']([^"']+)["']/g;

function toPosix(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function resolveToSrcRelative(filePath, specifier) {
  const absolute = path.resolve(path.dirname(filePath), specifier);
  const relative = path.relative(srcRoot, absolute);
  return toPosix(relative);
}

function isIntegrationModuleEntry(srcRelativePath) {
  if (!srcRelativePath.startsWith("intergrations/")) return false;
  const seg = srcRelativePath.split("/");
  return seg.length === 3 && seg[2] === "module.ts";
}

function getIntegrationName(srcRelativePath) {
  const seg = srcRelativePath.split("/");
  if (seg.length < 2 || seg[0] !== "intergrations") return "";
  return seg[1] || "";
}

function isAllowedCrossIntegrationTarget(target) {
  return (
    target.startsWith("intergrations/shared/") ||
    target.startsWith("intergrations/runtime/")
  );
}

async function collectTsFiles(dirPath) {
  const items = await fs.readdir(dirPath);
  const out = [];
  for (const name of items) {
    const abs = path.join(dirPath, name);
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) {
      out.push(...(await collectTsFiles(abs)));
      continue;
    }
    if (name.endsWith(".ts")) out.push(abs);
  }
  return out;
}

async function run() {
  const files = await collectTsFiles(integrationsRoot);
  const violations = [];

  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf-8");
    const srcRelativeFilePath = toPosix(path.relative(srcRoot, filePath));
    const isModuleEntry = isIntegrationModuleEntry(srcRelativeFilePath);
    const currentIntegrationName = getIntegrationName(srcRelativeFilePath);

    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = String(match[1] || "").trim();
      if (!specifier || !isRelativeSpecifier(specifier)) continue;

      const target = resolveToSrcRelative(filePath, specifier);

      // 规则 1（中文）：integration 全量禁止反向依赖 server。
      if (target.startsWith("server/")) {
        violations.push({
          file: srcRelativeFilePath,
          specifier,
          reason: "intergrations 层禁止直接依赖 server/*，请通过依赖注入访问运行时能力",
        });
      }

      // 规则 1.1（中文）：integration 全量禁止直接依赖 core。
      if (target.startsWith("core/")) {
        violations.push({
          file: srcRelativeFilePath,
          specifier,
          reason: "intergrations 层禁止直接依赖 core/*，请通过 server 注入端口能力",
        });
      }

      // 规则 2（中文）：integration module 入口禁止直接依赖 core/server。
      if (isModuleEntry && (target.startsWith("core/") || target.startsWith("server/"))) {
        violations.push({
          file: srcRelativeFilePath,
          specifier,
          reason: "intergrations/*/module.ts 禁止直接依赖 core/* 或 server/*",
        });
      }

      // 规则 3（中文）：integration 全量禁止跨 integration 直接依赖（shared/runtime 除外）。
      if (target.startsWith("intergrations/")) {
        const targetIntegrationName = getIntegrationName(target);
        const isSameIntegration =
          currentIntegrationName && targetIntegrationName === currentIntegrationName;
        const isAllowed = isAllowedCrossIntegrationTarget(target);

        if (!isSameIntegration && !isAllowed) {
          violations.push({
            file: srcRelativeFilePath,
            specifier,
            reason:
              "intergrations/* 禁止直接依赖其他 integration 模块，请通过 server 注入或 shared/runtime 能力解耦",
          });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log("✅ import boundaries passed");
    return;
  }

  console.error(`❌ import boundaries failed (${violations.length})`);
  for (const item of violations) {
    console.error(`- ${item.file}: ${item.specifier}`);
    console.error(`  ${item.reason}`);
  }
  process.exit(1);
}

await run();
