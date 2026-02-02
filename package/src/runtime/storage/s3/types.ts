import type { PermissionEngine } from "../../permission/index.js";

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
