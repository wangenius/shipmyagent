import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

export class HttpTransport {
  private url: string;
  private headers: Record<string, string>;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.url = url;
    this.headers = headers;
  }

  async start(): Promise<void> {
    // HTTP transport does not require a persistent connection
  }

  async close(): Promise<void> {
    // HTTP transport does not require closing
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        throw new Error(
          `HTTP request failed: ${response.status} ${response.statusText}`,
        );
      }

      const payload = (await response.json()) as JSONRPCMessage;
      this.onmessage?.(payload);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.onerror?.(normalized);
      throw normalized;
    }
  }
}
