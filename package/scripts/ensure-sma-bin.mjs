import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptsDir, "..");

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function findBinDirWithShipmyagent(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, "node_modules", ".bin");
    if (exists(path.join(candidate, "shipmyagent"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const binDir = findBinDirWithShipmyagent(packageRoot);

if (!binDir) {
  process.exit(0);
}

const shipmyagentBin = path.join(binDir, "shipmyagent");
const smaBin = path.join(binDir, "sma");

if (exists(smaBin) || !exists(shipmyagentBin)) {
  process.exit(0);
}

try {
  fs.symlinkSync("shipmyagent", smaBin);
  fs.chmodSync(smaBin, 0o755);
} catch {
  // Best-effort; don't fail install if the platform or FS blocks symlinks.
  process.exit(0);
}
