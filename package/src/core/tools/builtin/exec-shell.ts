/**
 * Shell execution tool.
 *
 * This is the runtime's "escape hatch" for repository operations. It is used by
 * the agent to read/search files, run tests, and perform safe modifications.
 *
 * NOTE: permission gating is handled at the product/runtime policy layer; this
 * module only performs execution with the project root as the working directory.
 */

import { z } from "zod";
import { tool } from "ai";
import { execa } from "execa";
import { getShipRuntimeContext } from "../../../server/ShipRuntimeContext.js";

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
  execute: async (
    { command, timeout = 30000 }: { command: string; timeout?: number },
  ) => {
    try {
      const result = await execa(command, {
        cwd: getShipRuntimeContext().rootPath,
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
