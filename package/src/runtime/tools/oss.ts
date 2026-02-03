/**
 * OSS (S3-compatible) configuration resolver.
 *
 * This is shared by:
 * - storage tools (`s3_upload`, `cloud_file_upload`)
 * - runtime storage backend wiring
 */

import type { ShipConfig } from "../../utils.js";
import type { S3StorageConfig } from "../storage/index.js";

export type OssResolved =
  | { enabled: false; storage?: undefined; bucket?: undefined }
  | { enabled: true; storage: S3StorageConfig; bucket?: string };

export function resolveOssFromConfig(config: ShipConfig): OssResolved {
  const oss = config?.oss;
  if (!oss) return { enabled: false };
  if (oss.enabled === false) return { enabled: false };
  if (oss.provider && oss.provider !== "s3") return { enabled: false };

  const endpoint = String(oss.endpoint || "").trim();
  const accessKeyId = String(oss.accessKeyId || "").trim();
  const secretAccessKey = String(oss.secretAccessKey || "").trim();
  const region = String(oss.region || "auto").trim() || "auto";
  const bucket = String(oss.bucket || "").trim() || undefined;

  if (!endpoint || !accessKeyId || !secretAccessKey) return { enabled: false };

  return {
    enabled: true,
    storage: { endpoint, accessKeyId, secretAccessKey, region },
    bucket,
  };
}
