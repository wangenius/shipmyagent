// API 基础地址
const API_BASE = 'http://localhost:3000';

// 状态管理
let currentApprovalId = null;
let pendingApprovalsInChat = new Map(); // 存储对话中的待审批请求

// 页面初始化
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initChat();
  initApprovals();
  initStatus();
  initModal();

  // 定期刷新审批列表和状态
  setInterval(refreshApprovals, 3000);
  setInterval(refreshStatus, 10000);
});

// 导航初始化
function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // 更新导航按钮状态
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // 更新面板显示
      document.querySelectorAll('.panel').forEach(panel => {
        panel.classList.remove('active');
      });
      document.getElementById(`${tab}-panel`).classList.add('active');

      // 触发刷新
      if (tab === 'approvals') {
        refreshApprovals();
      } else if (tab === 'status') {
        refreshStatus();
      }
    });
  });
}

// 聊天功能初始化
function initChat() {
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');

  // 发送消息
  async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    // 添加用户消息
    addMessage('user', message);
    chatInput.value = '';

    // 禁用发送按钮
    sendBtn.disabled = true;

    // 显示加载状态
    addMessage('system', '⏳ 正在思考...', true);

    try {
      const response = await fetch(`${API_BASE}/api/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instructions: message }),
      });

      const result = await response.json();

      // 移除加载消息
      const loadingMsg = document.querySelector('.message.system.loading');
      if (loadingMsg) {
        loadingMsg.remove();
      }

      if (result.success) {
        // 处理输出，解析审批请求
        addMessage('system', formatOutput(result.output || '执行完成'));
      } else {
        addMessage('system', `❌ ${result.error || result.message || '执行失败'}`);
      }
    } catch (error) {
      const loadingMsg = document.querySelector('.message.system.loading');
      if (loadingMsg) {
        loadingMsg.remove();
      }
      addMessage('system', `❌ 连接错误: ${error.message}`);
    } finally {
      sendBtn.disabled = false;
      chatInput.focus();
    }
  }

  sendBtn.addEventListener('click', sendMessage);

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// 添加消息到聊天界面
function addMessage(role, content, isLoading = false) {
  const messagesContainer = document.getElementById('chat-messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role} ${isLoading ? 'loading' : ''}`;

  const avatar = role === 'user' ? '👤' : '🤖';

  // 解析内容中的审批请求
  const parsedContent = parseApprovalRequests(content);

  messageDiv.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-content">
      ${parsedContent}
    </div>
  `;

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 解析审批请求标签
function parseApprovalRequests(content) {
  if (!content) return content;

  // 使用正则表达式匹配 <approval_request> 标签
  const approvalRegex = /<approval_request\s+id="([^"]+)"\s+type="([^"]+)">([\s\S]*?)<\/approval_request>/g;

  let result = content;
  result = result.replace(approvalRegex, (match, id, type, details) => {
    // 存储待审批请求
    pendingApprovalsInChat.set(id, { type, details, timestamp: Date.now() });

    // 渲染审批按钮
    return `
      <div class="approval-in-chat" data-approval-id="${id}" data-approval-type="${type}">
        <div class="approval-details">${escapeHtml(details)}</div>
        <div class="approval-actions">
          <button class="btn-approve-chat" onclick="handleChatApproval('${id}', 'approve')">✅ 批准</button>
          <button class="btn-reject-chat" onclick="handleChatApproval('${id}', 'reject')">❌ 拒绝</button>
        </div>
      </div>
    `;
  });

  return result;
}

// 处理对话中的审批
async function handleChatApproval(approvalId, action) {
  const approvalDiv = document.querySelector(`[data-approval-id="${approvalId}"]`);
  if (approvalDiv) {
    // 禁用按钮防止重复点击
    const buttons = approvalDiv.querySelectorAll('button');
    buttons.forEach(btn => btn.disabled = true);
    buttons.forEach(btn => btn.textContent = '⏳ 处理中...');
  }

  try {
    const response = await fetch(`${API_BASE}/api/approvals/${approvalId}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ response: `用户通过网页${action === 'approve' ? '批准' : '拒绝'}` }),
    });

    const result = await response.json();

    if (result.success) {
      // 更新按钮状态
      if (approvalDiv) {
        const buttons = approvalDiv.querySelectorAll('button');
        if (action === 'approve') {
          buttons.forEach(btn => {
            btn.textContent = '✅ 已批准';
            btn.classList.add('approved');
          });
          approvalDiv.classList.add('approved');
        } else {
          buttons.forEach(btn => {
            btn.textContent = '❌ 已拒绝';
            btn.classList.add('rejected');
          });
          approvalDiv.classList.add('rejected');
        }
      }

      // 显示结果
      if (action === 'approve') {
        addMessage('system', `✅ 操作已批准！正在执行...\n\n请刷新或继续对话查看结果。`);
      } else {
        addMessage('system', `❌ 操作已被拒绝。`);
      }

      // 刷新状态
      refreshStatus();
    } else {
      showToast(`操作失败: ${result.message}`, 'error');
      // 恢复按钮
      if (approvalDiv) {
        const buttons = approvalDiv.querySelectorAll('button');
        buttons.forEach(btn => btn.disabled = false);
        buttons.forEach(btn => {
          btn.textContent = btn.classList.contains('btn-approve-chat') ? '✅ 批准' : '❌ 拒绝';
        });
      }
    }
  } catch (error) {
    showToast(`操作失败: ${error.message}`, 'error');
  }
}

// 格式化输出
function formatOutput(output) {
  if (!output) return '执行完成';

  // 先解析审批请求
  let formatted = parseApprovalRequests(output);

  // 处理换行
  formatted = formatted.replace(/\n/g, '<br>');

  // 检测代码块
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  formatted = formatted.replace(codeBlockRegex, (match, lang, code) => {
    return `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`;
  });

  // 检测行内代码
  formatted = formatted.replace(/`([^`]+)`/g, (match, code) => {
    return `<code>${escapeHtml(code)}</code>`;
  });

  return formatted;
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 审批功能初始化
function initApprovals() {
  document.getElementById('refresh-approvals').addEventListener('click', refreshApprovals);
}

// 刷新审批列表
async function refreshApprovals() {
  try {
    const response = await fetch(`${API_BASE}/api/approvals`);
    const data = await response.json();

    const container = document.getElementById('approvals-container');
    const emptyState = document.getElementById('empty-approvals');
    const badge = document.getElementById('approval-count');

    const approvals = data.approvals || [];
    badge.textContent = approvals.length;
    badge.dataset.count = approvals.length;

    if (approvals.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    // 清除现有内容（保留 empty-state）
    const existingCards = container.querySelectorAll('.approval-card');
    existingCards.forEach(card => card.remove());

    // 添加审批卡片
    approvals.forEach(approval => {
      const card = createApprovalCard(approval);
      container.appendChild(card);
    });
  } catch (error) {
    console.error('获取审批列表失败:', error);
  }
}

// 创建审批卡片
function createApprovalCard(approval) {
  const card = document.createElement('div');
  card.className = 'approval-card';

  const typeLabel = {
    write_repo: '📝 写文件',
    exec_shell: '⚡ 执行命令',
    read_repo: '👁️ 读取文件',
  }[approval.type] || '📋 操作';

  const time = new Date(approval.createdAt).toLocaleString('zh-CN');

  card.innerHTML = `
    <div class="approval-card-header">
      <span class="approval-type ${approval.type}">${typeLabel}</span>
      <span class="approval-time">${time}</span>
    </div>
    <div class="approval-action">${escapeHtml(approval.action)}</div>
    <div class="approval-details">${formatDetails(approval.details)}</div>
  `;

  card.addEventListener('click', () => openApprovalModal(approval));

  return card;
}

// 格式化审批详情
function formatDetails(details) {
  if (!details) return '无详细说明';

  let html = '';

  if (details.filePath) {
    html += `文件: ${escapeHtml(details.filePath)}<br>`;
  }
  if (details.command) {
    html += `命令: <code>${escapeHtml(details.command)}</code><br>`;
  }
  if (details.content && typeof details.content === 'string') {
    html += `<br><pre>${escapeHtml(details.content)}</pre>`;
  }

  return html || '无详细说明';
}

// 打开审批弹窗
function openApprovalModal(approval) {
  currentApprovalId = approval.id;

  const modal = document.getElementById('approval-modal');
  const modalBody = document.getElementById('modal-body');

  const typeLabel = {
    write_repo: '📝 写文件',
    exec_shell: '⚡ 执行命令',
    read_repo: '👁️ 读取文件',
  }[approval.type] || '📋 操作';

  modalBody.innerHTML = `
    <h4>操作类型</h4>
    <p>${typeLabel}</p>

    <h4>操作说明</h4>
    <p>${escapeHtml(approval.action)}</p>

    <h4>详细信息</h4>
    ${formatDetails(approval.details)}

    <h4>创建时间</h4>
    <p>${new Date(approval.createdAt).toLocaleString('zh-CN')}</p>
  `;

  modal.classList.add('active');
}

// 关闭审批弹窗
function closeApprovalModal() {
  const modal = document.getElementById('approval-modal');
  modal.classList.remove('active');
  currentApprovalId = null;
}

// 审批操作
async function handleApproval(action) {
  if (!currentApprovalId) return;

  try {
    const response = await fetch(`${API_BASE}/api/approvals/${currentApprovalId}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ response: `用户通过网页${action === 'approve' ? '批准' : '拒绝'}` }),
    });

    const result = await response.json();

    if (result.success) {
      showToast(`审批${action === 'approve' ? '通过' : '拒绝'}成功`, 'success');
      closeApprovalModal();
      refreshApprovals();
      refreshStatus();
    } else {
      showToast(`审批失败: ${result.message}`, 'error');
    }
  } catch (error) {
    showToast(`操作失败: ${error.message}`, 'error');
  }
}

// 弹窗初始化
function initModal() {
  document.getElementById('close-modal').addEventListener('click', closeApprovalModal);
  document.getElementById('approve-btn').addEventListener('click', () => handleApproval('approve'));
  document.getElementById('reject-btn').addEventListener('click', () => handleApproval('reject'));

  // 点击遮罩关闭
  document.getElementById('approval-modal').addEventListener('click', (e) => {
    if (e.target.id === 'approval-modal') {
      closeApprovalModal();
    }
  });

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeApprovalModal();
    }
  });
}

// 状态功能初始化
function initStatus() {
  refreshStatus();
}

// 刷新状态
async function refreshStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/status`);
    const data = await response.json();

    const statusEl = document.getElementById('agent-status');
    statusEl.textContent = data.status === 'running' ? '运行中' : '已停止';
    statusEl.className = `status-value ${data.status !== 'running' ? 'error' : ''}`;

    document.getElementById('tasks-count').textContent = data.tasksCount || 0;
    document.getElementById('pending-count').textContent = data.pendingApprovalsCount || 0;

    // 更新徽章
    const badge = document.getElementById('approval-count');
    badge.textContent = data.pendingApprovalsCount || 0;
    badge.dataset.count = data.pendingApprovalsCount || 0;

    // 刷新日志
    refreshLogs();
  } catch (error) {
    console.error('获取状态失败:', error);
  }
}

// 刷新日志
async function refreshLogs() {
  try {
    const response = await fetch(`${API_BASE}/api/logs`);
    const data = await response.json();

    const logsContainer = document.getElementById('logs-content');
    const logs = data.logs || [];

    if (logs.length === 0) {
      logsContainer.textContent = '暂无日志';
      return;
    }

    // 显示最近 50 条日志
    const recentLogs = logs.slice(-50);
    logsContainer.textContent = recentLogs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString('zh-CN');
      return `[${time}] [${log.level.toUpperCase()}] ${log.message}`;
    }).join('\n');
  } catch (error) {
    console.error('获取日志失败:', error);
  }
}

// 显示 Toast 通知
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
  }[type] || 'ℹ️';

  toast.innerHTML = `<span>${icon}</span> ${escapeHtml(message)}`;
  container.appendChild(toast);

  // 3 秒后移除
  setTimeout(() => {
    toast.style.animation = 'toastSlideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 暴露给全局以便 onclick 调用
window.handleChatApproval = handleChatApproval;
window.handleApproval = handleApproval;
window.closeApprovalModal = closeApprovalModal;
