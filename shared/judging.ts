/**
 * 判定循环的形状(SPEC §5)。
 *
 * 三条容易写反的记账规则,写在类型旁边免得实现时忘:
 *   · **额度入队即扣**,判定不再动它 —— 额度是**入队许可证**,不是判定许可证。
 *   · **pending cap 与额度是两套账**,互不影响:被 cap 拦住的入队不扣额度,
 *     被额度拦住的入队不占 cap。
 *   · **还原提交不占 pending cap**,自己单独一条「每人最多 1 条未决」的账。
 */

import type { Answer } from './puzzleTypes';
import type { PlayerId } from './types';

export interface Question {
  id: string;
  askerId: PlayerId;
  text: string;
  askedAt: number;
  /** null = 还没判。判过之后进 history。 */
  answer: Answer | null;
  answeredAt: number | null;
  /** 被 oracle 重判过一次。Q&A 流里要标出来。 */
  corrected: boolean;
  /** 更正前是什么 —— 让推理链能看出「本来判的是 X」。 */
  previousAnswer: Answer | null;
}

export type SubmissionStatus = 'pending' | 'accepted' | 'rejected';

/**
 * 海龟汤的「提交还原」。独立通道:不占 pending cap,内容**全房可见**
 * (co-op 没有泄题问题 —— 所有人本来就共享同一条推理链)。
 */
export interface Submission {
  id: string;
  playerId: PlayerId;
  text: string;
  submittedAt: number;
  status: SubmissionStatus;
  resolvedAt: number | null;
}

export type RoundResult =
  /** 猜中了。20Q 是判了 CORRECT,海龟汤是还原被 accept。 */
  | 'hit'
  /** 20Q 额度耗尽、队列判空,仍无 CORRECT。 */
  | 'exhausted'
  /** oracle 主动公开汤底 · 结束本局。记为未猜中。 */
  | 'revealed';

/**
 * 一局的收束结果。
 *
 * **co-op 是群体胜利**,`winnerId` 只是「谁问出来的」这一笔标注,
 * 不代表这一局属于某个人(SPEC §5)。
 */
export interface RoundOutcome {
  result: RoundResult;
  winnerId: PlayerId | null;
  /** 共用了几问(已判 + 还在队里的都算,额度确实被它们花掉了)。 */
  questionsUsed: number;
  durationMs: number;
  /**
   * 真相快照。**收束的那一刻从 puzzle 拷进来** ——
   * 这样归位时清掉 puzzle,reveal 屏仍然有东西可显示。
   */
  truth: string;
  /** 命中来自哪条路径,reveal 屏的文案要用。 */
  via: 'judgment' | 'submission' | null;
}

export const JUDGING_LIMITS = {
  questionMax: 200,
  submissionMax: 600,
} as const;
