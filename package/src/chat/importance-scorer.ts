/**
 * 重要性评分算法
 *
 * 用于评估对话轮次的重要性，帮助在压缩时保留关键信息
 */

import type { ChatContextTurnV1 } from "../types/contexts.js";
import type { ImportanceScore } from "../types/context-compression.js";

/**
 * 关键词列表（用于识别重要对话）
 */
const IMPORTANT_KEYWORDS = {
  // 决策相关
  decision: ["决定", "选择", "采用", "使用", "不用", "放弃", "确定"],
  // 偏好相关
  preference: ["喜欢", "偏好", "习惯", "倾向", "更喜欢", "prefer", "like"],
  // 约束相关
  constraint: ["不能", "不要", "禁止", "必须", "一定要", "不允许", "限制"],
  // 问题相关
  problem: ["错误", "问题", "bug", "失败", "报错", "异常", "error"],
  // 重要信息
  important: ["重要", "关键", "核心", "主要", "注意", "警告", "important", "critical"],
};

/**
 * 计算单个对话轮次的重要性评分
 *
 * @param turn 对话轮次
 * @param index 在对话中的索引位置
 * @param totalTurns 总对话轮次数
 * @returns 重要性评分 (0-1)
 */
export function calculateImportanceScore(
  turn: ChatContextTurnV1,
  index: number,
  totalTurns: number
): ImportanceScore {
  let score = 0;
  const reasons: string[] = [];
  const text = String(turn.text || "").toLowerCase();

  // 1. 位置权重：最近的对话更重要
  const recencyWeight = Math.pow((index + 1) / totalTurns, 0.5);
  score += recencyWeight * 0.3;
  if (recencyWeight > 0.8) {
    reasons.push("最近的对话");
  }

  // 2. 长度权重：较长的对话可能包含更多信息
  const length = text.length;
  if (length > 500) {
    score += 0.15;
    reasons.push("详细的回复");
  } else if (length > 200) {
    score += 0.1;
  }

  // 3. 关键词匹配
  let keywordScore = 0;

  // 决策关键词
  for (const keyword of IMPORTANT_KEYWORDS.decision) {
    if (text.includes(keyword)) {
      keywordScore += 0.15;
      reasons.push("包含决策信息");
      break;
    }
  }

  // 偏好关键词
  for (const keyword of IMPORTANT_KEYWORDS.preference) {
    if (text.includes(keyword)) {
      keywordScore += 0.12;
      reasons.push("包含用户偏好");
      break;
    }
  }

  // 约束关键词
  for (const keyword of IMPORTANT_KEYWORDS.constraint) {
    if (text.includes(keyword)) {
      keywordScore += 0.15;
      reasons.push("包含约束条件");
      break;
    }
  }

  // 问题关键词
  for (const keyword of IMPORTANT_KEYWORDS.problem) {
    if (text.includes(keyword)) {
      keywordScore += 0.1;
      reasons.push("包含问题描述");
      break;
    }
  }

  // 重要性关键词
  for (const keyword of IMPORTANT_KEYWORDS.important) {
    if (text.includes(keyword)) {
      keywordScore += 0.12;
      reasons.push("标记为重要");
      break;
    }
  }

  score += Math.min(keywordScore, 0.4);

  // 4. 角色权重：用户消息通常更重要（包含需求和约束）
  if (turn.role === "user") {
    score += 0.1;
  }

  // 5. 代码块检测：包含代码的对话可能更重要
  if (text.includes("```") || text.includes("function") || text.includes("class")) {
    score += 0.1;
    reasons.push("包含代码");
  }

  // 6. 问题检测：包含问题的对话需要保留
  if (text.includes("?") || text.includes("？") || text.includes("如何") || text.includes("怎么")) {
    score += 0.08;
    reasons.push("包含问题");
  }

  // 归一化到 0-1
  score = Math.min(Math.max(score, 0), 1);

  return {
    turnIndex: index,
    score,
    reasons: reasons.length > 0 ? reasons : ["常规对话"],
  };
}

/**
 * 批量计算多个对话轮次的重要性评分
 *
 * @param turns 对话轮次列表
 * @returns 评分结果列表
 */
export function calculateImportanceScores(
  turns: ChatContextTurnV1[]
): ImportanceScore[] {
  return turns.map((turn, index) =>
    calculateImportanceScore(turn, index, turns.length)
  );
}

/**
 * 根据重要性评分筛选对话
 *
 * @param turns 对话轮次列表
 * @param targetCount 目标保留数量
 * @param minScore 最低评分阈值
 * @returns 筛选后的对话轮次
 */
export function filterByImportance(
  turns: ChatContextTurnV1[],
  targetCount: number,
  minScore: number = 0.3
): ChatContextTurnV1[] {
  const scores = calculateImportanceScores(turns);

  // 按评分排序
  const sorted = scores
    .map((score, index) => ({ score, turn: turns[index] }))
    .filter(item => item.score.score >= minScore)
    .sort((a, b) => b.score.score - a.score.score);

  // 取前 N 个
  const selected = sorted.slice(0, targetCount);

  // 按原始顺序返回
  return selected
    .sort((a, b) => a.score.turnIndex - b.score.turnIndex)
    .map(item => item.turn);
}
