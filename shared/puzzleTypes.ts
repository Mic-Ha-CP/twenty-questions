/**
 * SPEC §4 — **唯一分流点。**
 *
 * 纪律:两种 puzzle type 的**所有**差异只允许经由这张表。
 * 禁止 `if (puzzleType === ...)` 散落在逻辑里 —— server 的 phase 机 / 队列 / 判定循环
 * 读表跑,**不感知类型**。
 *
 * 验收标准:加第三个类型(Who Am I,SPEC §10)应该只需往表里加一行。
 * Client 允许分支渲染的只有三处:setup 屏 / 判定按钮组 / guess 入口。
 */

/** 判定语义 enum。**server 只发这个,永不发展示字符串**(SPEC §8)。 */
export const ANSWERS = ['YES', 'NO', 'UNCLEAR', 'IRRELEVANT', 'BOTH', 'CORRECT'] as const;
export type Answer = (typeof ANSWERS)[number];

/** 猜测形态:`judgment` = 猜测即提问,由 CORRECT 收束;`submission` = 独立还原通道。 */
export type GuessMode = 'judgment' | 'submission';

export const PUZZLE_TYPES = {
  twenty_questions: {
    /** CORRECT = 「就是它!」 */
    answers: ['YES', 'NO', 'UNCLEAR', 'CORRECT'],
    /** 全房共享,lobby 可调。 */
    defaultBudget: 20,
    /** oracle 直接输入答案词;另有可选「随机建议」词表(非题库)。 */
    hasBank: false,
    /** 猜测即提问,由 CORRECT 判定收束;**无独立摊牌**。 */
    guessMode: 'judgment',
  },
  situation: {
    // 海龟汤
    answers: ['YES', 'NO', 'IRRELEVANT', 'BOTH'],
    /** 无额度。 */
    defaultBudget: null,
    hasBank: true,
    /** 独立「提交还原」通道。 */
    guessMode: 'submission',
  },
} as const satisfies Record<string, PuzzleTypeConfig>;

export interface PuzzleTypeConfig {
  readonly answers: readonly Answer[];
  readonly defaultBudget: number | null;
  readonly hasBank: boolean;
  readonly guessMode: GuessMode;
}

export type PuzzleTypeId = keyof typeof PUZZLE_TYPES;

export const PUZZLE_TYPE_IDS = Object.keys(PUZZLE_TYPES) as PuzzleTypeId[];

export const DEFAULT_PUZZLE_TYPE: PuzzleTypeId = 'situation';

/** 读表的唯一入口。逻辑里想知道类型差异,只能从这里拿。 */
export function puzzleConfig(id: PuzzleTypeId): PuzzleTypeConfig {
  return PUZZLE_TYPES[id];
}

export function isPuzzleTypeId(v: unknown): v is PuzzleTypeId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PUZZLE_TYPES, v);
}
