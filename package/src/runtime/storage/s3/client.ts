import fs from "fs-extra";
import path from "path";
import { Readable } from "stream";
import type { PermissionEngine } from "../../permission/index.js";
import type { S3StorageConfig, S3UploadParams } from "./types.js";
import { sha256Hex, sha256HexOfFile, signAwsV4 } from "./aws-v4.js";
import { buildObjectPath, resolveFileWithinProject } from "./paths.js";

function normalizeEndpoint(endpointRaw: string): URL {
  const raw = String(endpointRaw || "").trim();
  if (!raw) throw new Error("Missing storage.endpoint");
  const endpoint = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  return new URL(endpoint);
}

export function getS3ObjectUrl(storage: S3StorageConfig, bucket: string, key: string): string {
  const baseUrl = normalizeEndpoint(storage.endpoint);
  const objectPath = buildObjectPath(baseUrl.pathname, bucket, key);
  const url = new URL(baseUrl.origin);
  url.pathname = objectPath;
  return url.toString();
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

    const baseUrl = normalizeEndpoint(endpointRaw);
    const objectPath = buildObjectPath(baseUrl.pathname, params.bucket, params.key);
    const url = new URL(baseUrl.origin);
    url.pathname = objectPath;

    const emptyPayloadHash = sha256Hex("");
    const signedHeaders = signAwsV4({
      method: "DELETE",
      url,
      headers: { "content-length": "0" },
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
  params: S3UploadParams & { storage: S3StorageConfig; permissionEngine: PermissionEngine },
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

    const baseUrl = normalizeEndpoint(endpointRaw);

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
