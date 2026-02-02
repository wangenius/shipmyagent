import path from "path";

function encodeRfc3986(value: string): string {
  return value.replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function awsEncodePath(pathname: string): string {
  const leading = pathname.startsWith("/") ? "/" : "";
  const trailing = pathname.endsWith("/") && pathname.length > 1 ? "/" : "";
  const core = pathname.replace(/^\/+|\/+$/g, "");
  if (!core) return "/";
  const encoded = core
    .split("/")
    .map((s) => encodeRfc3986(encodeURIComponent(s)))
    .join("/");
  return `${leading}${encoded}${trailing}`;
}

export function buildObjectPath(basePathname: string, bucket: string, key: string): string {
  const base = String(basePathname || "/").replace(/\/+$/g, "");
  const cleanBucket = bucket.replace(/^\/+|\/+$/g, "");
  const cleanKey = key.replace(/^\/+/g, "");
  const raw = `${base}/${cleanBucket}/${cleanKey}`.replace(/\/{2,}/g, "/");
  return awsEncodePath(raw);
}

export function resolveFileWithinProject(projectRoot: string, file: string): string {
  const absolutePath = path.resolve(projectRoot, file);
  const relative = path.relative(projectRoot, absolutePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`File must be inside project root: ${file}`);
  }
  return absolutePath;
}

