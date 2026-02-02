import fs from "fs-extra";
import path from "path";
import { getApprovalsDirPath } from "../../utils.js";
import type { ApprovalRequest } from "./types.js";

export class ApprovalStore {
  private projectRoot: string;
  private approvalRequests: Map<string, ApprovalRequest> = new Map();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.reloadPendingFromDisk();
  }

  reloadPendingFromDisk(): void {
    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    const next = new Map<string, ApprovalRequest>();

    if (!fs.existsSync(approvalsDir)) {
      this.approvalRequests = next;
      return;
    }

    try {
      const files = fs.readdirSync(approvalsDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const filePath = path.join(approvalsDir, file);
        try {
          const request = fs.readJsonSync(filePath) as ApprovalRequest;
          if (request.status === "pending") next.set(request.id, request);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    this.approvalRequests = next;
  }

  get(id: string): ApprovalRequest | undefined {
    return this.approvalRequests.get(id);
  }

  listPending(): ApprovalRequest[] {
    this.reloadPendingFromDisk();
    return Array.from(this.approvalRequests.values());
  }

  async save(request: ApprovalRequest): Promise<void> {
    this.approvalRequests.set(request.id, request);
    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    await fs.ensureDir(approvalsDir);
    const filePath = path.join(approvalsDir, `${request.id}.json`);

    const tempFilePath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    try {
      await fs.writeJson(tempFilePath, request, { spaces: 2 });
      await fs.rename(tempFilePath, filePath);
    } catch (error) {
      try {
        if (await fs.pathExists(tempFilePath)) await fs.remove(tempFilePath);
      } catch {
        // ignore
      }
      throw error;
    }
  }

  async update(id: string, patch: Partial<ApprovalRequest>): Promise<boolean> {
    if (!this.approvalRequests.has(id)) this.reloadPendingFromDisk();
    const existing = this.approvalRequests.get(id);
    if (!existing) return false;

    const updated: ApprovalRequest = { ...existing, ...patch, id: existing.id };
    await this.save(updated);
    return true;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.approvalRequests.has(id)) this.reloadPendingFromDisk();
    this.approvalRequests.delete(id);

    const approvalsDir = getApprovalsDirPath(this.projectRoot);
    const filePath = path.join(approvalsDir, `${id}.json`);
    try {
      if (fs.existsSync(filePath)) await fs.remove(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async waitForResult(
    requestId: string,
    timeoutSeconds: number = 300,
  ): Promise<"approved" | "rejected" | "timeout"> {
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - startTime < timeoutMs) {
      const request = this.approvalRequests.get(requestId);
      if (!request) {
        this.reloadPendingFromDisk();
        continue;
      }

      if (request.status === "approved") return "approved";
      if (request.status === "rejected") return "rejected";

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return "timeout";
  }
}
