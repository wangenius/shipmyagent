import { createHash, createHmac } from "crypto";
import fs from "fs-extra";

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
  items.sort((a, b) =>
    a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1,
  );
  return items
    .map(([k, v]) => {
      const ek = encodeRfc3986(encodeURIComponent(k));
      const ev = encodeRfc3986(encodeURIComponent(v));
      return `${ek}=${ev}`;
    })
    .join("&");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function sha256HexOfFile(filePath: string): Promise<string> {
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

export function signAwsV4(params: {
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

  return { ...headers, authorization };
}

