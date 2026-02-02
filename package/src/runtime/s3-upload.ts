import { createHash, createHmac } from "crypto";
import fs from "fs-extra";
import path from "path";
import { Readable } from "stream";
import { PermissionEngine } from "./permission.js";
export interface S3StorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export interface S3UploadParams {
  projectRoot: string;
  permissionEngine: PermissionEngine;
  bucket: string;
  file: string;
  key?: string;
  contentType?: string;
  region?: string;
}

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

function awsEncodeQuery(params: URLSearchParams): string {
  const items: Array<[string, string]> = [];
  for (const [k, v] of params.entries()) items.push([k, v]);
  items.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return items
    .map(([k, v]) => {
      const ek = encodeRfc3986(encodeURIComponent(k));
      const ev = encodeRfc3986(encodeURIComponent(v));
      return `${ek}=${ev}`;
    })
    .join("&");
}

function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

async function sha256HexOfFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  const dateStamp = `${yyyy}${mm}${dd}`;
  const amzDate = `${dateStamp}T${hh}${mi}${ss}Z`;
  return { amzDate, dateStamp };
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    const value = String(v).trim().replace(/\s+/g, " ");
    out[key] = value;
  }
  return out;
}

function signAwsV4(params: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  now?: Date;
}): Record<string, string> {
  const now = params.now ?? new Date();
  const { amzDate, dateStamp } = toAmzDate(now);

  const headers = normalizeHeaders({
    ...params.headers,
    host: params.url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": params.payloadHash,
  });

  const canonicalUri = awsEncodePath(params.url.pathname || "/");
  const canonicalQuery = awsEncodeQuery(params.url.searchParams);

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headers[k]}`).join("\n") + "\n";
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    params.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    params.payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, params.region);
  const kService = hmac(kRegion, params.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    authorization,
  };
}

function buildObjectPath(basePathname: string, bucket: string, key: string): string {
  const base = String(basePathname || "/").replace(/\/+$/g, "");
  const cleanBucket = bucket.replace(/^\/+|\/+$/g, "");
  const cleanKey = key.replace(/^\/+/g, "");
  const raw = `${base}/${cleanBucket}/${cleanKey}`.replace(/\/{2,}/g, "/");
  return awsEncodePath(raw);
}

export function getS3ObjectUrl(storage: S3StorageConfig, bucket: string, key: string): string {
  const endpointRaw = String(storage.endpoint || "").trim();
  if (!endpointRaw) throw new Error("Missing storage.endpoint");
  const endpoint = endpointRaw.startsWith("http://") || endpointRaw.startsWith("https://") ? endpointRaw : `https://${endpointRaw}`;
  const baseUrl = new URL(endpoint);
  const objectPath = buildObjectPath(baseUrl.pathname, bucket, key);
  const url = new URL(baseUrl.origin);
  url.pathname = objectPath;
  return url.toString();
}

function resolveFileWithinProject(projectRoot: string, file: string): string {
  const absolutePath = path.resolve(projectRoot, file);
  const relative = path.relative(projectRoot, absolutePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`File must be inside project root: ${file}`);
  }
  return absolutePath;
}

export async function deleteObjectFromS3(params: {
  storage: S3StorageConfig;
  bucket: string;
  key: string;
  region?: string;
}): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const endpointRaw = String(params.storage.endpoint || "").trim();
    const accessKeyId = String(params.storage.accessKeyId || "").trim();
    const secretAccessKey = String(params.storage.secretAccessKey || "").trim();
    const region = String(params.region || params.storage.region || "auto").trim();
    if (!endpointRaw || !accessKeyId || !secretAccessKey) {
      return { success: false, error: "Missing S3 storage configuration." };
    }

    const endpoint = endpointRaw.startsWith("http://") || endpointRaw.startsWith("https://") ? endpointRaw : `https://${endpointRaw}`;
    const baseUrl = new URL(endpoint);
    const objectPath = buildObjectPath(baseUrl.pathname, params.bucket, params.key);
    const url = new URL(baseUrl.origin);
    url.pathname = objectPath;

    const emptyPayloadHash = sha256Hex("");
    const signedHeaders = signAwsV4({
      method: "DELETE",
      url,
      headers: {
        "content-length": "0",
      },
      payloadHash: emptyPayloadHash,
      accessKeyId,
      secretAccessKey,
      region,
      service: "s3",
    });

    const response = await fetch(url.toString(), { method: "DELETE", headers: signedHeaders });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        success: false,
        url: url.toString(),
        error: `S3 delete failed: ${response.status} ${response.statusText}${text ? `\n${text}` : ""}`,
      };
    }

    return { success: true, url: url.toString() };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function uploadFileToS3(
  params: S3UploadParams & { storage: S3StorageConfig },
): Promise<{
  success: boolean;
  url?: string;
  etag?: string;
  bucket?: string;
  key?: string;
  filePath?: string;
  bytes?: number;
  error?: string;
}> {
  try {
    const endpointRaw = String(params.storage.endpoint || "").trim();
    const accessKeyId = String(params.storage.accessKeyId || "").trim();
    const secretAccessKey = String(params.storage.secretAccessKey || "").trim();
    const region = String(params.region || params.storage.region || "auto").trim();

    if (!endpointRaw || !accessKeyId || !secretAccessKey) {
      return { success: false, error: "Missing S3 storage configuration." };
    }

    const endpoint = endpointRaw.startsWith("http://") || endpointRaw.startsWith("https://") ? endpointRaw : `https://${endpointRaw}`;
    const baseUrl = new URL(endpoint);

    const filePath = resolveFileWithinProject(params.projectRoot, params.file);
    const permission = await params.permissionEngine.checkReadRepo(filePath);
    if (!permission.allowed) {
      return { success: false, error: `No permission to read file: ${permission.reason}` };
    }

    const exists = await fs.pathExists(filePath);
    if (!exists) return { success: false, error: `File not found: ${params.file}` };

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { success: false, error: `Not a file: ${params.file}` };

    const key = String(params.key || path.basename(filePath)).replace(/^\/+/g, "");
    const contentType = String(params.contentType || "application/octet-stream").trim();

    const objectPath = buildObjectPath(baseUrl.pathname, params.bucket, key);
    const uploadUrl = new URL(baseUrl.origin);
    uploadUrl.pathname = objectPath;

    const payloadHash = await sha256HexOfFile(filePath);
    const signedHeaders = signAwsV4({
      method: "PUT",
      url: uploadUrl,
      headers: {
        "content-type": contentType,
        "content-length": String(stat.size),
      },
      payloadHash,
      accessKeyId,
      secretAccessKey,
      region,
      service: "s3",
    });

    const body = Readable.toWeb(fs.createReadStream(filePath)) as any;
    const response = await fetch(uploadUrl.toString(), {
      method: "PUT",
      headers: signedHeaders,
      body,
      duplex: "half",
    } as any);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        success: false,
        error: `S3 upload failed: ${response.status} ${response.statusText}${text ? `\n${text}` : ""}`,
      };
    }

    const etag = response.headers.get("etag") || undefined;
    return {
      success: true,
      url: uploadUrl.toString(),
      etag,
      bucket: params.bucket,
      key,
      filePath: path.relative(params.projectRoot, filePath),
      bytes: stat.size,
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
