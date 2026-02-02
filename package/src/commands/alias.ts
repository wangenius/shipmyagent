import os from "os";
import path from "path";
import fs from "fs-extra";

interface AliasOptions {
  shell?: string;
  dryRun?: boolean;
  print?: boolean;
}

function upsertAliasBlock(content: string, aliasLine: string): { next: string; changed: boolean } {
  const start = "# >>> shipmyagent alias >>>";
  const end = "# <<< shipmyagent alias <<<";
  const block = `${start}\n${aliasLine}\n${end}\n`;

  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx).replace(/\s*$/, "");
    const after = content.slice(endIdx + end.length).replace(/^\s*\n?/, "\n");
    const next = `${before}\n\n${block}${after}`.replace(/\n{4,}/g, "\n\n\n");
    return { next, changed: next !== content };
  }

  const aliasRegex = /^\s*alias\s+sma\s*=/m;
  if (aliasRegex.test(content)) {
    return { next: content, changed: false };
  }

  const trimmed = content.replace(/\s*$/, "");
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  const next = `${prefix}${block}`;
  return { next, changed: true };
}

export async function aliasCommand(options: AliasOptions = {}): Promise<void> {
  const aliasLine = `alias sma="shipmyagent"`;

  if (options.print) {
    console.log(aliasLine);
    return;
  }

  const shell = String(options.shell || "both").toLowerCase();
  const targets: Array<"zsh" | "bash"> =
    shell === "zsh" ? ["zsh"] : shell === "bash" ? ["bash"] : ["zsh", "bash"];

  const home = os.homedir();
  const rcFiles = targets.map((s) => path.join(home, s === "zsh" ? ".zshrc" : ".bashrc"));

  const changedFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const rcPath of rcFiles) {
    const exists = await fs.pathExists(rcPath);
    const current = exists ? await fs.readFile(rcPath, "utf-8") : "";
    const { next, changed } = upsertAliasBlock(current, aliasLine);

    if (!changed) {
      skippedFiles.push(rcPath);
      continue;
    }

    if (!options.dryRun) {
      await fs.outputFile(rcPath, next, "utf-8");
    }
    changedFiles.push(rcPath);
  }

  if (options.dryRun) {
    console.log("🔎 dry-run: will update");
  } else {
    console.log("✅ alias written");
  }

  for (const p of changedFiles) console.log(`- ${p}`);
  for (const p of skippedFiles) console.log(`- (skip) ${p}`);

  console.log("\n要在当前终端会话生效，请手动刷新：");
  if (targets.includes("zsh")) console.log(`- source ${path.join(home, ".zshrc")}`);
  if (targets.includes("bash")) console.log(`- source ${path.join(home, ".bashrc")}`);
  console.log('- 或重新打开一个终端');
}

