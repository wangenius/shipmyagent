import { z } from "zod";
import { tool } from "ai";
import { cloudFileDelete, cloudFileUpload, cloudFileUrl } from "../runtime/storage/index.js";
import { resolveOssFromConfig } from "./oss.js";
import { getToolRuntimeContext } from "./runtime-context.js";

export const cloud_file_upload = tool({
  description:
    "Upload a project-local file and return an accessible URL. Default strategy: upload to OSS (S3-compatible) if configured, otherwise copy to `.ship/public` and return `/public/*` URL if `cloudFiles.publicBaseUrl` is configured.",
  inputSchema: z.object({
    filePath: z.string().describe("Local file path (relative to project root)"),
    contentType: z.string().optional().describe("Optional Content-Type"),
    key: z.string().optional().describe("Optional object key / public path"),
    prefer: z.enum(["oss", "public"]).optional().describe("Prefer oss or public"),
    bucket: z.string().optional().describe("Override OSS bucket (otherwise uses oss.bucket)"),
    publicPath: z.string().optional().describe("Override public path under .ship/public (otherwise uses key)"),
  }),
  execute: async (args: {
    filePath: string;
    contentType?: string;
    key?: string;
    prefer?: "oss" | "public";
    bucket?: string;
    publicPath?: string;
  }) => {
    const { projectRoot, permissionEngine, config } = getToolRuntimeContext();
    const oss = resolveOssFromConfig(config);

    const cloudFiles = (config as any)?.cloudFiles || {};
    const cloudFilesConfig = {
      publicBaseUrl:
        typeof cloudFiles.publicBaseUrl === "string" ? cloudFiles.publicBaseUrl : undefined,
      publicRoutePrefix:
        typeof cloudFiles.publicRoutePrefix === "string" ? cloudFiles.publicRoutePrefix : undefined,
    };

    return cloudFileUpload({
      projectRoot,
      permissionEngine,
      storage: oss.enabled ? { config: oss.storage, bucket: oss.bucket } : undefined,
      cloudFiles: cloudFilesConfig,
      filePath: args.filePath,
      key: args.key,
      contentType: args.contentType,
      prefer: args.prefer,
      bucket: args.bucket,
      publicPath: args.publicPath,
    });
  },
});

export const cloud_file_url = tool({
  description:
    "Build an accessible URL for a previously uploaded cloud file (OSS object URL or `/public/*` URL).",
  inputSchema: z.object({
    method: z.enum(["oss", "public"]).describe("Which backend the file is stored in"),
    bucket: z.string().optional().describe("OSS bucket (optional if oss.bucket configured)"),
    key: z.string().optional().describe("OSS object key"),
    publicPath: z.string().optional().describe("Path under .ship/public, e.g. uploads/a.pdf"),
  }),
  execute: async (args: {
    method: "oss" | "public";
    bucket?: string;
    key?: string;
    publicPath?: string;
  }) => {
    const { config } = getToolRuntimeContext();
    const oss = resolveOssFromConfig(config);
    const cloudFiles = (config as any)?.cloudFiles || {};
    const cloudFilesConfig = {
      publicBaseUrl:
        typeof cloudFiles.publicBaseUrl === "string" ? cloudFiles.publicBaseUrl : undefined,
      publicRoutePrefix:
        typeof cloudFiles.publicRoutePrefix === "string" ? cloudFiles.publicRoutePrefix : undefined,
    };

    return cloudFileUrl({
      method: args.method,
      storage: oss.enabled ? { config: oss.storage, bucket: oss.bucket } : undefined,
      cloudFiles: cloudFilesConfig,
      bucket: args.bucket,
      key: args.key,
      publicPath: args.publicPath,
    });
  },
});

export const cloud_file_delete = tool({
  description:
    "Delete a previously uploaded cloud file (OSS object or `.ship/public` file).",
  inputSchema: z.object({
    method: z.enum(["oss", "public"]).describe("Which backend the file is stored in"),
    bucket: z.string().optional().describe("OSS bucket (optional if oss.bucket configured)"),
    key: z.string().optional().describe("OSS object key"),
    publicPath: z.string().optional().describe("Path under .ship/public, e.g. uploads/a.pdf"),
  }),
  execute: async (args: {
    method: "oss" | "public";
    bucket?: string;
    key?: string;
    publicPath?: string;
  }) => {
    const { projectRoot, config } = getToolRuntimeContext();
    const oss = resolveOssFromConfig(config);
    const cloudFiles = (config as any)?.cloudFiles || {};
    const cloudFilesConfig = {
      publicBaseUrl:
        typeof cloudFiles.publicBaseUrl === "string" ? cloudFiles.publicBaseUrl : undefined,
      publicRoutePrefix:
        typeof cloudFiles.publicRoutePrefix === "string" ? cloudFiles.publicRoutePrefix : undefined,
    };

    return cloudFileDelete({
      projectRoot,
      method: args.method,
      storage: oss.enabled ? { config: oss.storage, bucket: oss.bucket } : undefined,
      cloudFiles: cloudFilesConfig,
      bucket: args.bucket,
      key: args.key,
      publicPath: args.publicPath,
    });
  },
});

export const cloudFileTools = {
  cloud_file_upload,
  cloud_file_url,
  cloud_file_delete,
};
