export function matchRepoPathPattern(pattern: string, filePath: string): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return filePath.startsWith(prefix) || filePath.includes(prefix + "/");
  }
  if (pattern.startsWith("**/")) {
    return filePath.includes(pattern.slice(3));
  }
  return filePath === pattern || filePath.includes(pattern.replace("*", ""));
}

