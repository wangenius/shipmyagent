export function resolveEnvVar(value: string): string {
  return String(value || "").replace(/\$\{([^}]+)\}/g, (_: string, varName: string) => {
    return process.env[varName] || "";
  });
}

export function resolveEnvVarsInRecord(
  record: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    resolved[key] = resolveEnvVar(value);
  }
  return resolved;
}

