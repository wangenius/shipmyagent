import { z } from "zod";
import { tool } from "ai";
import { execa } from "execa";
import type { ShipConfig } from "../utils.js";
import { extractExecShellCommandNames } from "../runtime/permission.js";
import { getToolRuntimeContext } from "./runtime-context.js";

function preflightExecShell(config: ShipConfig, command: string): {
  allowed: boolean;
  deniedReason?: string;
  needsApproval: boolean;
} {
  const execConfigAny = (config as any)?.permissions?.exec_shell;

  if (execConfigAny === true) {
    return { allowed: true, needsApproval: false };
  }
  if (!execConfigAny || execConfigAny === false) {
    return {
      allowed: false,
      deniedReason: "Shell execution permission not configured",
      needsApproval: false,
    };
  }

  const execConfig = execConfigAny as {
    deny?: string[];
    allow?: string[];
    requiresApproval?: boolean;
  };

  const commandNames = extractExecShellCommandNames(command);
  if (commandNames.length === 0) {
    return { allowed: false, deniedReason: "Empty command", needsApproval: false };
  }

  if (Array.isArray(execConfig.deny) && execConfig.deny.length > 0) {
    const deniedNames = execConfig.deny
      .map((d) => String(d).trim().split(/\s+/)[0] || "")
      .filter(Boolean)
      .map((d) => d.split("/").pop() || d);
    const hit = commandNames.find((n) => deniedNames.includes(n));
    if (hit) {
      return {
        allowed: false,
        deniedReason: `Command denied by blacklist: ${hit}`,
        needsApproval: false,
      };
    }
  } else if (Array.isArray(execConfig.allow) && execConfig.allow.length > 0) {
    const allowedNames = execConfig.allow
      .map((a) => String(a).trim().split(/\s+/)[0] || "")
      .filter(Boolean)
      .map((a) => a.split("/").pop() || a);
    const isAllowed = commandNames.every((n) => allowedNames.includes(n));
    if (!isAllowed) {
      return {
        allowed: false,
        deniedReason: "Command not in allow list",
        needsApproval: false,
      };
    }
  }

  return { allowed: true, needsApproval: Boolean(execConfig.requiresApproval) };
}

export const exec_shell = tool({
  description: `Execute a shell command. This is your ONLY tool for interacting with the filesystem and codebase.

Use this tool for ALL operations:
- Reading files: cat, head, tail, less
- Writing files: echo >, cat > file << EOF, sed -i
- Searching: grep -r, find, rg
- Listing: ls, find, tree
- File operations: cp, mv, rm, mkdir
- Code analysis: grep, wc, awk
- Git operations: git status, git diff, git log
- Running tests: npm test, npm run build
- Any other shell command

Chain commands with && for sequential execution or ; for independent execution.`,
  inputSchema: z.object({
    command: z
      .string()
      .describe("Shell command to execute. Can be a single command or multiple commands chained with && or ;"),
    timeout: z.number().optional().default(30000).describe("Timeout in milliseconds (default: 30000)"),
  }),
  needsApproval: async ({ command }) => {
    const { config } = getToolRuntimeContext();
    const preflight = preflightExecShell(config, command);
    return preflight.allowed && preflight.needsApproval;
  },
  execute: async (
    { command, timeout = 30000 }: { command: string; timeout?: number },
  ) => {
    const { projectRoot, config } = getToolRuntimeContext();
    const preflight = preflightExecShell(config, command);
    if (!preflight.allowed) {
      return {
        success: false,
        error: `No permission to execute: ${command} (${preflight.deniedReason || "denied"})`,
      };
    }

    try {
      const result = await execa(command, {
        cwd: projectRoot,
        timeout,
        reject: false,
        shell: true,
      });

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      return { success: false, error: `Command execution failed: ${String(error)}` };
    }
  },
});

export const execShellTools = { exec_shell };

