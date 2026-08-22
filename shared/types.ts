/**
 * Core shared types — 前后端唯一真源。
 *
 * 分层纪律(PLATFORM.md「The room-layer boundary」):
 *   ROOM LAYER   = 另一个完全不同的游戏会一字不差地要的东西。
 *   GAME LAYER   = 编码了本游戏规则的东西,永不漏进 room layer。
 * 本文件把两段用注释明确隔开;加字段前先想清楚它属于哪半边。
 */

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
}
