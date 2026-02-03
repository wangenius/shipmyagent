import fs from "fs-extra";
import path from "path";
import type { S3StorageConfig } from "./s3/types.js";
import { deleteObjectFromS3, getS3ObjectUrl, uploadFileToS3 } from "./s3/client.js";

export interface CloudFilesConfig {
  publicBaseUrl?: string;
  publicRoutePrefix?: string;
}

function normalizePublicRoutePrefix(prefix: string | undefined): string {
  const raw = String(prefix || "/public").trim() || "/public";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/g, "");
}

function normalizePublicBaseUrl(baseUrl: string): string {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/g, "");
  const url = new URL(trimmed);
  if (!url.protocol || !url.host) throw new Error("Invalid publicBaseUrl");
  return url.toString().replace(/\/+$/g, "");
}

function encodePathForUrl(p: string): string {
  return p
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function resolveFileWithinProject(projectRoot: string, filePath: string): string {
  const absolutePath = path.resolve(projectRoot, filePath);
  const relative = path.relative(projectRoot, absolutePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`File must be inside project root: ${filePath}`);
  }
  return absolutePath;
}

function safePublicRelativePath(input: string): string {
  const decoded = decodeURIComponent(String(input || ""));
  const normalized = path.posix.normalize(decoded.replace(/\\/g, "/"));
  if (normalized === "." || normalized === "") return "";
  const stripped = normalized.replace(/^(\.?\/)?\.ship\/public\/?/, "");
  if (stripped === "." || stripped === "") return "";
  if (stripped.startsWith("..") || stripped.includes("/..")) {
    throw new Error(`Invalid public path: ${input}`);
  }
  return stripped;
}

function makeUploadKey(originalFilePath: string): string {
  const base = path.basename(originalFilePath);
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `uploads/${ts}-${base}`;
}

export async function cloudFileUpload(params: {
  projectRoot: string;
  storage?: { config: S3StorageConfig; bucket?: string };
  cloudFiles?: CloudFilesConfig;
  filePath: string;
  key?: string;
  contentType?: string;
  bucket?: string;
  publicPath?: string;
  prefer?: "oss" | "public";
}): Promise<
  | {
      success: true;
      method: "oss";
      url: string;
      bucket: string;
      key: string;
      bytes?: number;
      etag?: string;
      filePath: string;
    }
  | {
      success: true;
      method: "public";
      url: string;
      localPath: string;
      publicPath: string;
      filePath: string;
      bytes?: number;
    }
  | { success: false; error: string }
> {
  try {
    const absolute = resolveFileWithinProject(params.projectRoot, params.filePath);

    const exists = await fs.pathExists(absolute);
    if (!exists) return { success: false, error: `File not found: ${params.filePath}` };
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) return { success: false, error: `Not a file: ${params.filePath}` };

    const candidateKey = String(params.key || "").trim() || makeUploadKey(absolute);
    const prefer = params.prefer || "oss";

    const tryOss = async () => {
      const storage = params.storage?.config;
      const bucket = String(params.bucket || "").trim() || String(params.storage?.bucket || "").trim();
      if (!storage || !bucket) return { ok: false as const, error: "OSS is not configured." };

      const out = await uploadFileToS3({
        projectRoot: params.projectRoot,
        storage,
        bucket,
        file: params.filePath,
        key: candidateKey,
        contentType: params.contentType,
      });
      if (!out.success) return { ok: false as const, error: out.error || "OSS upload failed." };
      return {
        ok: true as const,
        result: {
          success: true as const,
          method: "oss" as const,
          url: String(out.url),
          bucket: String(out.bucket),
          key: String(out.key),
          bytes: out.bytes,
          etag: out.etag,
          filePath: String(out.filePath || params.filePath),
        },
      };
    };

    const tryPublic = async () => {
      const publicBaseUrlRaw = String(params.cloudFiles?.publicBaseUrl || "").trim();
      if (!publicBaseUrlRaw) return { ok: false as const, error: "publicBaseUrl is not configured." };

      const publicBaseUrl = normalizePublicBaseUrl(publicBaseUrlRaw);
      const publicPrefix = normalizePublicRoutePrefix(params.cloudFiles?.publicRoutePrefix);

      const rel = safePublicRelativePath(String(params.publicPath || "").trim() || candidateKey);
      const dest = path.join(params.projectRoot, ".ship", "public", rel);
      await fs.ensureDir(path.dirname(dest));
      await fs.copyFile(absolute, dest);

      const url = `${publicBaseUrl}${publicPrefix}/${encodePathForUrl(rel)}`
        .replace(/\/{2,}/g, "/")
        .replace(":/", "://");

      return {
        ok: true as const,
        result: {
          success: true as const,
          method: "public" as const,
          url,
          localPath: `.ship/public/${rel}`,
          publicPath: rel,
          filePath: params.filePath,
          bytes: stat.size,
        },
      };
    };

    if (prefer === "public") {
      const pub = await tryPublic();
      if (pub.ok) return pub.result;
      const oss = await tryOss();
      if (oss.ok) return oss.result;
      return { success: false, error: "No upload path configured (oss or public)." };
    }

    const oss = await tryOss();
    if (oss.ok) return oss.result;
    const pub = await tryPublic();
    if (pub.ok) return pub.result;

    return { success: false, error: "No upload path configured (oss or public)." };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function cloudFileUrl(params: {
  storage?: { config: S3StorageConfig; bucket?: string };
  cloudFiles?: CloudFilesConfig;
  method: "oss" | "public";
  bucket?: string;
  key?: string;
  publicPath?: string;
}): { success: true; url: string } | { success: false; error: string } {
  try {
    if (params.method === "oss") {
      const storage = params.storage?.config;
      const bucket = String(params.bucket || params.storage?.bucket || "").trim();
      const key = String(params.key || "").trim();
      if (!storage || !bucket || !key) {
        return { success: false, error: "Missing oss config/bucket/key." };
      }
      return { success: true, url: getS3ObjectUrl(storage, bucket, key) };
    }

    const publicBaseUrlRaw = String(params.cloudFiles?.publicBaseUrl || "").trim();
    if (!publicBaseUrlRaw) return { success: false, error: "publicBaseUrl is not configured." };
    const publicBaseUrl = normalizePublicBaseUrl(publicBaseUrlRaw);
    const publicPrefix = normalizePublicRoutePrefix(params.cloudFiles?.publicRoutePrefix);
    const rel = safePublicRelativePath(String(params.publicPath || "").trim());
    if (!rel) return { success: false, error: "Missing publicPath." };
    const url = `${publicBaseUrl}${publicPrefix}/${encodePathForUrl(rel)}`
      .replace(/\/{2,}/g, "/")
      .replace(":/", "://");
    return { success: true, url };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function cloudFileDelete(params: {
  projectRoot: string;
  storage?: { config: S3StorageConfig; bucket?: string };
  cloudFiles?: CloudFilesConfig;
  method: "oss" | "public";
  bucket?: string;
  key?: string;
  publicPath?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (params.method === "oss") {
      const storage = params.storage?.config;
      const bucket = String(params.bucket || params.storage?.bucket || "").trim();
      const key = String(params.key || "").trim();
      if (!storage || !bucket || !key) return { success: false, error: "Missing oss config/bucket/key." };
      const out = await deleteObjectFromS3({ storage, bucket, key });
      if (!out.success) return { success: false, error: out.error || "OSS delete failed." };
      return { success: true };
    }

    const rel = safePublicRelativePath(String(params.publicPath || "").trim());
    if (!rel) return { success: false, error: "Missing publicPath." };
    const target = path.join(params.projectRoot, ".ship", "public", rel);
    const exists = await fs.pathExists(target);
    if (!exists) return { success: true };
    const stat = await fs.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) return { success: false, error: "publicPath is not a file." };
    await fs.remove(target);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
