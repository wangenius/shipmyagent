import fs from 'fs-extra';
import path from 'path';
import { diffLines } from 'diff';
import { generateId, getTimestamp, getApprovalsDirPath } from '../utils.js';
export class PermissionEngine {
    config;
    projectRoot;
    approvalRequests = new Map();
    constructor(config, projectRoot) {
        this.config = config;
        this.projectRoot = projectRoot;
        // Load existing approval requests from filesystem
        this.loadApprovalsFromDisk();
    }
    /**
     * Load pending approval requests from filesystem to memory
     */
    async loadApprovalsFromDisk() {
        const approvalsDir = getApprovalsDirPath(this.projectRoot);
        if (!fs.existsSync(approvalsDir)) {
            return;
        }
        try {
            const files = await fs.readdir(approvalsDir);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            for (const file of jsonFiles) {
                const filePath = path.join(approvalsDir, file);
                try {
                    const request = await fs.readJson(filePath);
                    // Only load pending requests
                    if (request.status === 'pending') {
                        this.approvalRequests.set(request.id, request);
                    }
                }
                catch (readError) {
                    console.warn(`⚠️ Failed to read approval file: ${filePath}`);
                }
            }
        }
        catch (error) {
            console.warn(`⚠️ Failed to load approvals directory: ${approvalsDir}`);
        }
    }
    async checkReadRepo(filePath) {
        const paths = this.config.read_repo;
        if (paths === true) {
            return { allowed: true, reason: 'Read permission enabled', requiresApproval: false };
        }
        if (paths === false) {
            return { allowed: false, reason: 'Read permission disabled', requiresApproval: false };
        }
        // Check if path matches
        if (paths.paths && paths.paths.length > 0) {
            const isAllowed = paths.paths.some(pattern => this.matchPattern(pattern, filePath));
            return {
                allowed: isAllowed,
                reason: isAllowed ? 'Path matches' : 'Path does not match',
                requiresApproval: false,
            };
        }
        return { allowed: true, reason: 'Default allow', requiresApproval: false };
    }
    async checkWriteRepo(filePath, content) {
        const writeConfig = this.config.write_repo;
        if (!writeConfig) {
            return { allowed: false, reason: 'Write permission not configured', requiresApproval: true };
        }
        // Check if path matches
        if (writeConfig.paths && writeConfig.paths.length > 0) {
            const isAllowed = writeConfig.paths.some(pattern => this.matchPattern(pattern, filePath));
            if (!isAllowed) {
                return {
                    allowed: false,
                    reason: 'Path not in allow list',
                    requiresApproval: writeConfig.requiresApproval,
                };
            }
        }
        // If approval required, create approval request
        if (writeConfig.requiresApproval) {
            const diff = await this.generateFileDiff(filePath, content);
            const request = await this.createApprovalRequest('write_repo', 'Modify file', {
                filePath,
                content: diff,
            });
            return {
                allowed: false,
                reason: 'Write operation requires approval',
                requiresApproval: true,
                approvalId: request.id,
            };
        }
        return { allowed: true, reason: 'Write permission allowed', requiresApproval: false };
    }
    async checkExecShell(command) {
        const execConfig = this.config.exec_shell;
        if (!execConfig) {
            return { allowed: false, reason: 'Shell execution permission not configured', requiresApproval: true };
        }
        // Check if command is in allow list
        if (execConfig.allow && execConfig.allow.length > 0) {
            const isAllowed = execConfig.allow.some(cmd => command.startsWith(cmd.split(' ')[0] || ''));
            if (!isAllowed) {
                return {
                    allowed: false,
                    reason: 'Command not in allow list',
                    requiresApproval: execConfig.requiresApproval,
                };
            }
        }
        // If approval required, create approval request
        if (execConfig.requiresApproval) {
            const request = await this.createApprovalRequest('exec_shell', 'Execute shell command', {
                command,
            });
            return {
                allowed: false,
                reason: 'Shell execution requires approval',
                requiresApproval: true,
                approvalId: request.id,
            };
        }
        return { allowed: true, reason: 'Shell execution permission allowed', requiresApproval: false };
    }
    matchPattern(pattern, filePath) {
        // Simple glob pattern matching
        if (pattern.endsWith('/**')) {
            const prefix = pattern.slice(0, -3);
            return filePath.startsWith(prefix) || filePath.includes(prefix + '/');
        }
        if (pattern.startsWith('**/')) {
            return filePath.includes(pattern.slice(3));
        }
        return filePath === pattern || filePath.includes(pattern.replace('*', ''));
    }
    async generateFileDiff(filePath, newContent) {
        if (!fs.existsSync(filePath)) {
            return `New file: ${filePath}\n\n${newContent}`;
        }
        const oldContent = await fs.readFile(filePath, 'utf-8');
        const changes = diffLines(oldContent, newContent);
        let diff = `File: ${filePath}\n\n`;
        for (const change of changes) {
            if (change.added) {
                diff += `+ ${change.value.trimEnd()}\n`;
            }
            else if (change.removed) {
                diff += `- ${change.value.trimEnd()}\n`;
            }
        }
        return diff;
    }
    async createApprovalRequest(type, action, details) {
        const request = {
            id: generateId(),
            type,
            action,
            details,
            status: 'pending',
            createdAt: getTimestamp(),
        };
        this.approvalRequests.set(request.id, request);
        // Save to filesystem
        const approvalsDir = getApprovalsDirPath(this.projectRoot);
        const filePath = path.join(approvalsDir, `${request.id}.json`);
        await fs.writeJson(filePath, request, { spaces: 2 });
        return request;
    }
    async approveRequest(requestId, response) {
        const request = this.approvalRequests.get(requestId);
        if (!request) {
            return false;
        }
        request.status = 'approved';
        request.response = response;
        request.respondedAt = getTimestamp();
        // Update filesystem
        const approvalsDir = getApprovalsDirPath(this.projectRoot);
        const filePath = path.join(approvalsDir, `${requestId}.json`);
        await fs.writeJson(filePath, request, { spaces: 2 });
        return true;
    }
    async rejectRequest(requestId, response) {
        const request = this.approvalRequests.get(requestId);
        if (!request) {
            return false;
        }
        request.status = 'rejected';
        request.response = response;
        request.respondedAt = getTimestamp();
        // Update filesystem
        const approvalsDir = getApprovalsDirPath(this.projectRoot);
        const filePath = path.join(approvalsDir, `${requestId}.json`);
        await fs.writeJson(filePath, request, { spaces: 2 });
        return true;
    }
    getPendingApprovals() {
        return Array.from(this.approvalRequests.values()).filter(request => request.status === 'pending');
    }
    getApprovalRequest(id) {
        return this.approvalRequests.get(id);
    }
    /**
     * Wait for approval result
     * @param requestId Approval request ID
     * @param timeoutSeconds Timeout in seconds
     * @returns Approval result: approved | rejected | timeout
     */
    async waitForApproval(requestId, timeoutSeconds = 300) {
        const startTime = Date.now();
        const timeoutMs = timeoutSeconds * 1000;
        while (Date.now() - startTime < timeoutMs) {
            const request = this.approvalRequests.get(requestId);
            if (!request) {
                // May have been loaded, retry reading from disk
                await this.loadApprovalsFromDisk();
                continue;
            }
            if (request.status === 'approved') {
                return 'approved';
            }
            if (request.status === 'rejected') {
                return 'rejected';
            }
            // Wait 1 second before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return 'timeout';
    }
    getConfig() {
        return this.config;
    }
}
export function createPermissionEngine(projectRoot) {
    const shipJsonPath = path.join(projectRoot, 'ship.json');
    let config = {
        read_repo: true,
        write_repo: { requiresApproval: true },
        exec_shell: { allow: [], requiresApproval: false },
    };
    if (fs.existsSync(shipJsonPath)) {
        try {
            const shipConfig = fs.readJsonSync(shipJsonPath);
            config = { ...config, ...shipConfig.permissions };
        }
        catch (error) {
            console.warn('⚠️ Failed to read ship.json, using default permission config');
        }
    }
    return new PermissionEngine(config, projectRoot);
}
//# sourceMappingURL=permission.js.map