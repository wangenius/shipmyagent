/**
 * 元数据提取器
 *
 * 从对话中自动提取结构化元数据：
 * - 主题标签
 * - 实体（人名、项目名、技术栈）
 * - 用户意图
 * - 关键决策
 */

import type { ChatContextTurnV1 } from "../types/contexts.js";
import type { ChatContextMetadata } from "../types/context-compression.js";

/**
 * 主题关键词映射
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  "编程": ["代码", "编程", "开发", "实现", "函数", "class", "bug", "调试"],
  "前端": ["react", "vue", "angular", "html", "css", "javascript", "typescript", "前端", "ui", "组件"],
  "后端": ["api", "数据库", "服务器", "后端", "接口", "sql", "redis", "缓存"],
  "AI/ML": ["ai", "机器学习", "深度学习", "模型", "训练", "llm", "gpt", "claude"],
  "数据": ["数据", "分析", "统计", "可视化", "图表", "报表"],
  "部署": ["部署", "上线", "发布", "docker", "kubernetes", "ci/cd"],
  "测试": ["测试", "单元测试", "集成测试", "test", "jest", "pytest"],
  "文档": ["文档", "说明", "readme", "注释", "documentation"],
  "性能": ["性能", "优化", "慢", "卡顿", "内存", "cpu", "性能优化"],
  "安全": ["安全", "漏洞", "权限", "认证", "授权", "加密"],
};

/**
 * 意图关键词映射
 */
const INTENT_KEYWORDS: Record<string, string[]> = {
  "询问": ["是什么", "怎么", "如何", "为什么", "能不能", "可以吗", "?", "？"],
  "请求": ["帮我", "请", "能否", "麻烦", "想要", "需要"],
  "反馈": ["很好", "不错", "有问题", "错了", "不对", "谢谢", "感谢"],
  "确认": ["对", "是的", "没错", "正确", "好的", "ok", "确认"],
  "否定": ["不", "不是", "错", "不对", "不行", "不可以"],
};

/**
 * 实体提取正则表达式
 */
const ENTITY_PATTERNS = {
  // 技术栈/框架
  tech: /\b(react|vue|angular|node\.?js|python|java|typescript|javascript|go|rust|docker|kubernetes|redis|mongodb|postgresql|mysql)\b/gi,
  // 文件名/路径
  file: /\b[\w-]+\.(ts|js|py|java|go|rs|json|yaml|yml|md|txt)\b/gi,
  // 项目名（通常是连字符或驼峰命名）
  project: /\b[A-Z][a-zA-Z0-9]*(?:[A-Z][a-z0-9]*)+\b/g,
  // URL
  url: /https?:\/\/[^\s]+/gi,
};

/**
 * 决策关键词
 */
const DECISION_KEYWORDS = [
  "决定", "选择", "采用", "使用", "不用", "放弃", "确定",
  "最终", "最后", "改为", "换成", "迁移到"
];

/**
 * 提取主题标签
 */
function extractTopics(turns: ChatContextTurnV1[]): string[] {
  const topicScores = new Map<string, number>();
  const allText = turns.map(t => String(t.text || "").toLowerCase()).join(" ");

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(keyword, "gi");
      const matches = allText.match(regex);
      if (matches) {
        score += matches.length;
      }
    }
    if (score > 0) {
      topicScores.set(topic, score);
    }
  }

  // 按分数排序，取前 5 个
  return Array.from(topicScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
}

/**
 * 提取实体
 */
function extractEntities(turns: ChatContextTurnV1[]): string[] {
  const entities = new Set<string>();
  const allText = turns.map(t => String(t.text || "")).join(" ");

  // 提取技术栈
  const techMatches = allText.match(ENTITY_PATTERNS.tech);
  if (techMatches) {
    techMatches.forEach(match => entities.add(match.toLowerCase()));
  }

  // 提取文件名
  const fileMatches = allText.match(ENTITY_PATTERNS.file);
  if (fileMatches) {
    fileMatches.slice(0, 10).forEach(match => entities.add(match));
  }

  // 提取项目名
  const projectMatches = allText.match(ENTITY_PATTERNS.project);
  if (projectMatches) {
    projectMatches.slice(0, 5).forEach(match => {
      if (match.length > 3) { // 过滤太短的
        entities.add(match);
      }
    });
  }

  return Array.from(entities).slice(0, 20);
}

/**
 * 提取用户意图
 */
function extractUserIntents(turns: ChatContextTurnV1[]): string[] {
  const intentScores = new Map<string, number>();

  // 只分析用户的消息
  const userTexts = turns
    .filter(t => t.role === "user")
    .map(t => String(t.text || "").toLowerCase());

  for (const text of userTexts) {
    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          intentScores.set(intent, (intentScores.get(intent) || 0) + 1);
        }
      }
    }
  }

  // 按频率排序
  return Array.from(intentScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([intent]) => intent);
}

/**
 * 提取关键决策
 */
function extractKeyDecisions(turns: ChatContextTurnV1[]): string[] {
  const decisions: string[] = [];

  for (const turn of turns) {
    const text = String(turn.text || "");
    const lowerText = text.toLowerCase();

    // 检查是否包含决策关键词
    const hasDecisionKeyword = DECISION_KEYWORDS.some(keyword =>
      lowerText.includes(keyword)
    );

    if (hasDecisionKeyword) {
      // 提取包含决策关键词的句子
      const sentences = text.split(/[。！？.!?]/);
      for (const sentence of sentences) {
        const lowerSentence = sentence.toLowerCase();
        if (DECISION_KEYWORDS.some(keyword => lowerSentence.includes(keyword))) {
          const trimmed = sentence.trim();
          if (trimmed.length > 10 && trimmed.length < 200) {
            decisions.push(trimmed);
          }
        }
      }
    }
  }

  return decisions.slice(0, 10);
}

/**
 * 计算重要性评分
 */
function calculateImportance(turns: ChatContextTurnV1[]): number {
  let score = 0;

  // 1. 对话长度（越长越重要）
  const totalChars = turns.reduce((sum, t) => sum + String(t.text || "").length, 0);
  score += Math.min(totalChars / 10000, 0.3);

  // 2. 对话轮次（越多越重要）
  score += Math.min(turns.length / 50, 0.2);

  // 3. 是否包含代码
  const hasCode = turns.some(t => String(t.text || "").includes("```"));
  if (hasCode) {
    score += 0.2;
  }

  // 4. 是否包含决策
  const hasDecision = turns.some(t => {
    const text = String(t.text || "").toLowerCase();
    return DECISION_KEYWORDS.some(keyword => text.includes(keyword));
  });
  if (hasDecision) {
    score += 0.15;
  }

  // 5. 是否包含问题
  const hasQuestion = turns.some(t => {
    const text = String(t.text || "");
    return text.includes("?") || text.includes("？");
  });
  if (hasQuestion) {
    score += 0.1;
  }

  // 6. 用户参与度（用户消息占比）
  const userTurns = turns.filter(t => t.role === "user").length;
  const userRatio = turns.length > 0 ? userTurns / turns.length : 0;
  score += userRatio * 0.05;

  return Math.min(Math.max(score, 0), 1);
}

/**
 * 提取对话元数据
 *
 * @param turns 对话轮次列表
 * @returns 元数据对象
 */
export function extractMetadata(turns: ChatContextTurnV1[]): ChatContextMetadata {
  if (!turns || turns.length === 0) {
    return {
      topics: [],
      entities: [],
      userIntents: [],
      keyDecisions: [],
      importance: 0,
    };
  }

  return {
    topics: extractTopics(turns),
    entities: extractEntities(turns),
    userIntents: extractUserIntents(turns),
    keyDecisions: extractKeyDecisions(turns),
    importance: calculateImportance(turns),
  };
}

/**
 * 批量提取元数据（用于处理多个上下文）
 */
export function extractMetadataBatch(
  contextsWithTurns: Array<{ id: string; turns: ChatContextTurnV1[] }>
): Map<string, ChatContextMetadata> {
  const results = new Map<string, ChatContextMetadata>();

  for (const context of contextsWithTurns) {
    const metadata = extractMetadata(context.turns);
    results.set(context.id, metadata);
  }

  return results;
}

/**
 * 合并多个元数据（用于聚合分析）
 */
export function mergeMetadata(metadataList: ChatContextMetadata[]): ChatContextMetadata {
  const allTopics = new Set<string>();
  const allEntities = new Set<string>();
  const allIntents = new Set<string>();
  const allDecisions: string[] = [];
  let totalImportance = 0;

  for (const metadata of metadataList) {
    metadata.topics?.forEach(t => allTopics.add(t));
    metadata.entities?.forEach(e => allEntities.add(e));
    metadata.userIntents?.forEach(i => allIntents.add(i));
    if (metadata.keyDecisions) {
      allDecisions.push(...metadata.keyDecisions);
    }
    totalImportance += metadata.importance || 0;
  }

  return {
    topics: Array.from(allTopics).slice(0, 10),
    entities: Array.from(allEntities).slice(0, 30),
    userIntents: Array.from(allIntents),
    keyDecisions: allDecisions.slice(0, 20),
    importance: metadataList.length > 0 ? totalImportance / metadataList.length : 0,
  };
}
