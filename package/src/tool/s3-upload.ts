import { z } from "zod";
import { tool } from "ai";
import { uploadFileToS3 } from "../runtime/s3-upload.js";
import { resolveOssFromConfig } from "./oss.js";
import { getToolRuntimeContext } from "./runtime-context.js";

export const s3_upload = tool({
  description:
    "Upload a local file (inside the project) to an S3-compatible object storage (including Cloudflare R2). Requires `oss` configured in ship.json.",
  inputSchema: z.object({
    bucket: z.string().describe("Bucket name"),
    file: z.string().describe("Local file path (relative to project root)"),
    key: z.string().optional().describe("Object key (default: basename(file))"),
    contentType: z.string().optional().describe("Content-Type (default: application/octet-stream)"),
    region: z.string().optional().describe("SigV4 region (default: auto)"),
  }),
  execute: async (args: {
    bucket: string;
    file: string;
    key?: string;
    contentType?: string;
    region?: string;
  }) => {
    const { projectRoot, permissionEngine, config } = getToolRuntimeContext();
    const oss = resolveOssFromConfig(config);
    if (!oss.enabled) {
      return { success: false, error: "OSS is not configured in ship.json (oss.*)." };
    }

    return uploadFileToS3({
      projectRoot,
      permissionEngine,
      storage: oss.storage,
      bucket: args.bucket,
      file: args.file,
      key: args.key,
      contentType: args.contentType,
      region: args.region,
    });
  },
});

export const s3UploadTools = { s3_upload };

