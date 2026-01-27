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
    }
    async checkReadRepo(filePath) {
        const paths = this.config.read_repo;
        if (paths === true) {
            return { allowed: true, reason: '读权限已启用', requiresApproval: false };
        }
        if (paths === false) {
            return { allowed: false, reason: '读权限已禁用', requiresApproval: false };
        }
        // 检查路径是否匹配
        if (paths.paths && paths.paths.length > 0) {
            const isAllowed = paths.paths.some(pattern => this.matchPattern(pattern, filePath));
            return {
                allowed: isAllowed,
                reason: isAllowed ? '路径匹配' : '路径不匹配',
                requiresApproval: false,
            };
        }
        return { allowed: true, reason: '默认允许', requiresApproval: false };
    }
    async checkWriteRepo(filePath, content) {
        const writeConfig = this.config.write_repo;
        if (!writeConfig) {
            return { allowed: false, reason: '写权限未配置', requiresApproval: true };
        }
        // 检查路径是否匹配
        if (writeConfig.paths && writeConfig.paths.length > 0) {
            const isAllowed = writeConfig.paths.some(pattern => this.matchPattern(pattern, filePath));
            if (!isAllowed) {
                return {
                    allowed: false,
                    reason: '路径不在允许列表中',
                    requiresApproval: writeConfig.requiresApproval,
                };
            }
        }
        // 如果需要审批，创建审批请求
        if (writeConfig.requiresApproval) {
            const diff = await this.generateFileDiff(filePath, content);
            const request = await this.createApprovalRequest('write_repo', '修改文件', {
                filePath,
                content: diff,
            });
            return {
                allowed: false,
                reason: '写操作需要审批',
                requiresApproval: true,
                approvalId: request.id,
            };
        }
        return { allowed: true, reason: '写权限已允许', requiresApproval: false };
    }
    async checkExecShell(command) {
        const execConfig = this.config.exec_shell;
        if (!execConfig) {
            return { allowed: false, reason: 'Shell 执行权限未配置', requiresApproval: true };
        }
        // 检查命令是否在允许列表中
        if (execConfig.allow && execConfig.allow.length > 0) {
            const isAllowed = execConfig.allow.some(cmd => command.startsWith(cmd.split(' ')[0] || ''));
            if (!isAllowed) {
                return {
                    allowed: false,
                    reason: '命令不在允许列表中',
                    requiresApproval: execConfig.requiresApproval,
                };
            }
        }
        // 如果需要审批，创建审批请求
        if (execConfig.requiresApproval) {
            const request = await this.createApprovalRequest('exec_shell', '执行 Shell 命令', {
                command,
            });
            return {
                allowed: false,
                reason: 'Shell 执行需要审批',
                requiresApproval: true,
                approvalId: request.id,
            };
        }
        return { allowed: true, reason: 'Shell 执行权限已允许', requiresApproval: false };
    }
    matchPattern(pattern, filePath) {
        // 简单的 glob 模式匹配
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
            return `新文件: ${filePath}\n\n${newContent}`;
        }
        const oldContent = await fs.readFile(filePath, 'utf-8');
        const changes = diffLines(oldContent, newContent);
        let diff = `文件: ${filePath}\n\n`;
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
        // 保存到文件系统
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
        // 更新文件系统
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
        // 更新文件系统
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
    getConfig() {
        return this.config;
    }
}
export function createPermissionEngine(projectRoot) {
    const shipJsonPath = path.join(projectRoot, 'ship.json');
    let config = {
        read_repo: true,
        write_repo: { requiresApproval: true },
        exec_shell: { requiresApproval: true },
    };
    if (fs.existsSync(shipJsonPath)) {
        try {
            const shipConfig = fs.readJsonSync(shipJsonPath);
            config = { ...config, ...shipConfig.permissions };
        }
        catch (error) {
            console.warn('⚠️ 读取 ship.json 失败，使用默认权限配置');
        }
    }
    return new PermissionEngine(config, projectRoot);
}
//# sourceMappingURL=permission.js.map