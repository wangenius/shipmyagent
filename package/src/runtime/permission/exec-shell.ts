import path from "path";

export function extractExecShellCommandNames(command: string): string[] {
  const trimmed = String(command || "").trim();
  if (!trimmed) return [];

  const separators = /(?:\r?\n|&&|\|\||;|\|)/g;
  const segments = trimmed.split(separators);
  const names: string[] = [];

  const isAssignment = (token: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

  for (const rawSegment of segments) {
    let segment = rawSegment.trim();
    if (!segment) continue;

    const parts = segment.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < parts.length) {
      const token = String(parts[i] || "").replace(/^[({]+/, "");
      if (!token) {
        i += 1;
        continue;
      }

      if (isAssignment(token)) {
        i += 1;
        continue;
      }

      if (token === "sudo") {
        i += 1;
        while (i < parts.length && /^-/.test(parts[i] || "")) i += 1;
        if (parts[i] === "--") i += 1;
        continue;
      }

      if (token === "env") {
        i += 1;
        while (i < parts.length && isAssignment(String(parts[i] || ""))) i += 1;
        continue;
      }

      if (token === "command") {
        i += 1;
        while (i < parts.length && /^-/.test(parts[i] || "")) i += 1;
        continue;
      }

      const base = path.basename(token);
      if (base) names.push(base);
      break;
    }
  }

  return names;
}

