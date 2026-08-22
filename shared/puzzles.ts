/**
 * 题目形状(SPEC §6)。
 *
 * 一个关键设计:**两种 puzzle type 共用同一个 `PuzzleDraft` 形状**,不是两套。
 * 海龟汤 = surface(汤面,公开)+ truth(汤底,oracle only);
 * 20Q    = surface 为 null + truth 存答案词。
 * 于是 server 的 setup 逻辑不需要知道自己在跑哪一种 —— 差异只体现在
 * config 表的 `hasBank`(有没有题库)上,而那是 client 的 setup 屏该分支的地方。
 */

/** 题库条目。**完整形态只在 server 内存里存在**,永不整个发给 client。 */
export interface SituationPuzzle {
  id: string;
  /** 题名 —— 选题列表展示的就是它。 */
  title: string;
  /** 汤面:oracle 确认选定后向全房公开。 */
  surface: string;
  /** 汤底:**oracle only**,直到 reveal。 */
  truth: string;
  difficulty?: 1 | 2 | 3;
  tags?: string[];
}

/**
 * 防剧透三件套之一:**选题列表只出这三样**。
 * 汤面汤底结构性缺席 —— 和 `toSummary` 一样是 whitelist,不是过滤。
 */
export interface PuzzleListItem {
  id: string;
  title: string;
  difficulty?: 1 | 2 | 3;
  tags?: string[];
}

/** 从完整题目投影出列表项。这是**唯一**允许把题库条目发出去的通道。 */
export function toListItem(p: SituationPuzzle): PuzzleListItem {
  const item: PuzzleListItem = { id: p.id, title: p.title };
  if (p.difficulty !== undefined) item.difficulty = p.difficulty;
  if (p.tags !== undefined) item.tags = [...p.tags];
  return item;
}

/** oracle 录好、房间持有的那一份。 */
export interface PuzzleDraft {
  /** 来源:题库 / 自写(20Q 的答案词也算自写)。 */
  source: 'bank' | 'own';
  /** 题库来源时的 id —— per-room 已用 Set 靠它去重。自写题为 null。 */
  bankId: string | null;
  /** 题名。自写题可为 null。 */
  title: string | null;
  /** 汤面:**公开**。20Q 没有汤面,为 null。 */
  surface: string | null;
  /** 汤底 / 答案词:**oracle only**,直到 reveal。 */
  truth: string;
}

/** guesser 视角看到的那一份 —— truth 结构性缺席。 */
export interface PublicPuzzle {
  title: string | null;
  surface: string | null;
  /** 题目录好了没。20Q 的 guesser 只能看到这个:有了,但看不见内容。 */
  ready: true;
}

/** 长度上限。防的是手滑粘一整篇进来,不是防攻击。 */
export const PUZZLE_LIMITS = {
  titleMax: 40,
  surfaceMax: 600,
  truthMax: 1200,
  /** 20Q 答案词:单行,短。 */
  answerWordMax: 40,
} as const;
