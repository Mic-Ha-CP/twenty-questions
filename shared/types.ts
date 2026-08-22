/**
 * Core shared types — 前后端唯一真源。
 *
 * 分层纪律(PLATFORM.md「The room-layer boundary」):
 *   ROOM LAYER   = 另一个完全不同的游戏会一字不差地要的东西。
 *   GAME LAYER   = 编码了本游戏规则的东西,永不漏进 room layer。
 * 本文件把两段用注释明确隔开;加字段前先想清楚它属于哪半边。
 */

import type { Question, RoundOutcome, Submission } from './judging';
import type { PuzzleListItem, PublicPuzzle } from './puzzles';
import type { PuzzleTypeId } from './puzzleTypes';

/* ────────────────────────────  ROOM LAYER  ──────────────────────────── */

/** 稳定身份。localStorage 里活着,与 socket 解耦 —— 断线重连与 oracle 接管的基础。 */
export type PlayerId = string;

/** 房间的身份键:随机码。公开房另有 displayNumber,私密房永远没有。 */
export type RoomCode = string;

/**
 * 房间层的 Player。**不含任何游戏专属字段。**
 * 形状照 PLATFORM.md「Verified generic surface」登记的名字,不发明分叉。
 */
export interface Player {
  id: PlayerId;
  /** 纯展示。重名 server 端重摇 —— identity 永远是 id(ADR-10)。 */
  nickname: string;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  /** 断线时刻;宽限计时用。在线时为 null。 */
  disconnectedAt: number | null;
  /**
   * 通用面 #1。**v1 无消费者** —— 存在是为了让将来的 AI oracle 是「座位上的一个 player」,
   * 而不是一条新的房间类型 / 新代码路径(SPEC §0「No solo room type」)。
   */
  isBot?: boolean;
}

/** 通用面 #7 双轨寻址:公开房拿号,私密房**永不**拿号(否则未列出的房可被枚举)。 */
export interface RoomAddress {
  code: RoomCode;
  /** 仅公开房。私密房恒为 null。 */
  displayNumber: number | null;
}

/* ────────────────────────────  GAME LAYER  ──────────────────────────── */

/**
 * SPEC §3。
 *
 * ⚠️ 与 PLATFORM.md 的登记有意偏差:通用层说「至少有 lobby 和 ended 两端」,
 * 本游戏**没有 ended** —— 房间跨局不散,`reveal` 是一局的终点而不是房间的终点。
 * 详见 NOTES 偏差 log。
 */
export const PHASES = ['lobby', 'setup', 'playing', 'reveal'] as const;
export type Phase = (typeof PHASES)[number];

/** Lobby 可改的设置项(SPEC §4)。**仅 lobby phase 可改**,且仅 host。 */
export interface RoomSettings {
  puzzleType: PuzzleTypeId;
  /** 20Q 全房共享额度;海龟汤为 null(无额度)。来自 config 表的 defaultBudget。 */
  budget: number | null;
  /** per-player 未判问题上限,默认 1,可调 1–3。 */
  pendingCap: number;
  isPrivate: boolean;
  maxPlayers: number;
}

/* ──────────────────────────  WIRE PAYLOADS  ─────────────────────────── */

/**
 * 通用面 #6:`toSummary()` 是 **whitelist 投影**,不是脱敏。
 * 字段在这里被**结构性地列举**,所以后加进房间状态的任何字段
 * (汤底、答案词、队列……)**不可能**意外漏进 lobby 列表。
 */
export interface RoomSummary {
  code: RoomCode;
  displayNumber: number | null;
  phase: Phase;
  playerCount: number;
  maxPlayers: number;
  puzzleType: PuzzleTypeId;
  /** oracle 位是否有人 —— lobby 行要显示「缺出题人」。不发是谁。 */
  hasOracle: boolean;
  hostNickname: string;
}

/**
 * `toClientState(viewerId)` 的产物。**机制通用,遮蔽策略是游戏规则。**
 * v1 scaffold 阶段只含房间层 + oracle 座位;题目/队列/额度在后续 session 加,
 * 加的时候遮蔽发生在 server 侧的投影里,**不是** client 侧隐藏。
 */
export interface RoomState {
  code: RoomCode;
  displayNumber: number | null;
  phase: Phase;
  players: Player[];
  hostId: PlayerId;
  /** 显式座位,可空(SPEC §2)。 */
  oracleId: PlayerId | null;
  settings: RoomSettings;
  /** 收件人自己的 id —— client 用它判断「我是不是 oracle / host」,不靠猜。 */
  viewerId: PlayerId;

  /* ─── setup 之后才有值。**遮蔽发生在 server 的投影里,不在 client 侧隐藏。** ─── */

  /**
   * 题目的**公开面**:汤面 + 题名。全房可见。
   * 20Q 的 surface 是 null —— guesser 只知道「题录好了」,看不见答案词。
   */
  puzzle: PublicPuzzle | null;
  /**
   * 汤底 / 答案词。**只有 oracle 的那一份 RoomState 里有值**,其余人恒为 null。
   * 这一条静默失效 = 游戏直接不能玩且没人立刻发现 —— PROJECT_RIGOR §4 必测 1。
   */
  oracleTruth: string | null;
  /**
   * 选题列表(防剧透投影:只有 title + tags/difficulty)。
   * **只发给 oracle**:让 guesser 看见候选题名本身就是剧透。
   * 无题库的 puzzle type 恒为 null。
   */
  bank: PuzzleListItem[] | null;
  /** 这一房把题库用光了没 —— 用光时 client 引导去自写。 */
  bankExhausted: boolean;

  /* ─── playing(SPEC §5)。**队列、历史、额度、还原全房可见** ─── */

  /** 未判的问题,FIFO。oracle 严格判队首。 */
  queue: Question[];
  /** 已判的问题,按判定顺序。被更正过的带 corrected / previousAnswer。 */
  history: Question[];
  /** 海龟汤的还原提交。内容全房可见 —— co-op 没有泄题问题。 */
  submissions: Submission[];
  /** 全房共享额度;无额度的类型恒为 null。 */
  budgetLeft: number | null;
  /** 自己还能提几问(pending cap 剩余)。per-viewer,方便 client 直接禁用输入框。 */
  myPendingLeft: number;
  /**
   * 收束结果。**只有收束之后才非 null**,`truth` 也只在那时才对全房公开。
   * 在此之前真相只经由 `oracleTruth` 给 oracle。
   */
  outcome: RoundOutcome | null;
}
