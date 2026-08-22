/**
 * Room — 房间层(通用)+ oracle 座位(游戏层)。
 *
 * 两半在本文件里用注释分区。加字段前先判:另一个完全不同的游戏会一字不差地要它吗?
 * 会 → 通用半区;编码了本游戏规则 → 游戏半区。**永不把游戏半区的东西挪进通用半区。**
 *
 * Authoritative server:所有 mutation 是**同步**方法,自校验,返回 Result。
 * 同步是 oracle 座位「先到先得」成立的原因 —— 方法体内不 await,
 * 两个并发申领之间没有交错窗口。**别在这些方法里引入 await。**
 */

import { err, ok, OK, type ErrorCode, type Result } from '@shared/events';
import { GAME_META } from '@shared/meta';
import { rerollUniqueName } from '@shared/names';
import {
  DEFAULT_PUZZLE_TYPE,
  isPuzzleTypeId,
  puzzleConfig,
} from '@shared/puzzleTypes';
import type {
  Phase,
  Player,
  PlayerId,
  RoomCode,
  RoomSettings,
  RoomState,
  RoomSummary,
} from '@shared/types';
import { canTransition } from '../game/phases';

export interface RoomInit {
  code: RoomCode;
  displayNumber: number | null;
  host: { id: PlayerId; nickname: string };
  isPrivate: boolean;
  now: number;
}

export class Room {
  /* ───────────────── ROOM LAYER (generic) ───────────────── */
  readonly code: RoomCode;
  /** 通用面 #7:私密房恒为 null —— 顺序号会让未列出的房可被枚举。 */
  displayNumber: number | null;
  players: Player[] = [];
  hostId: PlayerId;
  readonly createdAt: number;
  lastActivityAt: number;

  /* ───────────────── GAME LAYER ───────────────── */
  phase: Phase = 'lobby';
  /** SPEC §2:显式座位,可空。host ≠ oracle,两权分离。 */
  oracleId: PlayerId | null = null;
  settings: RoomSettings;

  constructor(init: RoomInit) {
    this.code = init.code;
    this.displayNumber = init.isPrivate ? null : init.displayNumber;
    this.hostId = init.host.id;
    this.createdAt = init.now;
    this.lastActivityAt = init.now;
    this.settings = {
      puzzleType: DEFAULT_PUZZLE_TYPE,
      budget: puzzleConfig(DEFAULT_PUZZLE_TYPE).defaultBudget,
      pendingCap: GAME_META.pendingCapDefault,
      isPrivate: init.isPrivate,
      maxPlayers: GAME_META.defaultMaxPlayers,
    };
    this.players.push({
      id: init.host.id,
      nickname: init.host.nickname,
      isHost: true,
      isReady: false,
      connected: true,
      disconnectedAt: null,
    });
  }

  /* ─────────────────────── lookups ─────────────────────── */

  player(id: PlayerId): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  has(id: PlayerId): boolean {
    return this.players.some((p) => p.id === id);
  }

  isHost(id: PlayerId): boolean {
    return this.hostId === id;
  }

  isOracle(id: PlayerId): boolean {
    return this.oracleId === id;
  }

  /** 通用面 #4:全是 bot 或空房 → false。bot 永不继承 host,空房该被拆掉。 */
  hasHumanPlayers(): boolean {
    return this.players.some((p) => !p.isBot);
  }

  touch(now: number): void {
    this.lastActivityAt = now;
  }

  /* ───────────────────── membership ────────────────────── */

  addPlayer(id: PlayerId, desiredName: string, now: number): Result<Player> {
    const existing = this.player(id);
    if (existing) {
      // 重连:稳定 playerId 重新绑上来,不是新人。
      existing.connected = true;
      existing.disconnectedAt = null;
      this.touch(now);
      return ok(existing);
    }
    if (this.players.length >= this.settings.maxPlayers) return err('ROOM_FULL');

    // 重名 server 端重摇 —— 安全,因为 identity 是 id 不是名字(ADR-10)。
    const nickname = rerollUniqueName(
      this.players.map((p) => p.nickname),
      desiredName,
    );
    const player: Player = {
      id,
      nickname,
      isHost: this.players.length === 0,
      isReady: false,
      connected: true,
      disconnectedAt: null,
    };
    if (player.isHost) this.hostId = id;
    this.players.push(player);
    this.touch(now);
    return ok(player);
  }

  /** 离开 = 真的移除。断线不是离开(见 markDisconnected)。 */
  removePlayer(id: PlayerId, now: number): void {
    this.players = this.players.filter((p) => p.id !== id);
    this.touch(now);
    this.releaseSeatsOf(id);
    this.ensureHost();
  }

  /** 断线:标记不移除,等宽限。重连时 playerId 重绑新 socket。 */
  markDisconnected(id: PlayerId, now: number): void {
    const p = this.player(id);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = now;
    this.touch(now);
  }

  /** 超过宽限仍未回来的断线玩家。RoomManager 的扫描调它。 */
  expiredDisconnects(now: number): PlayerId[] {
    return this.players
      .filter(
        (p) =>
          !p.connected &&
          p.disconnectedAt !== null &&
          now - p.disconnectedAt > GAME_META.disconnectGraceMs,
      )
      .map((p) => p.id);
  }

  /**
   * 通用面 #3:lobby-phase、host-only、可踢任何**别人**(bot 与人规则一致)。
   * 自校验,返回 Result —— 后果由调用方负责。
   */
  kickPlayer(requesterId: PlayerId, targetId: PlayerId, now: number): Result<void> {
    if (!this.isHost(requesterId)) return err('NOT_HOST');
    if (this.phase !== 'lobby') return err('NOT_LOBBY_PHASE');
    if (requesterId === targetId) return err('CANNOT_TARGET_SELF');
    if (!this.has(targetId)) return err('PLAYER_NOT_FOUND');
    this.removePlayer(targetId, now);
    return OK;
  }

  /** host 转移(显式)。host 离开时的隐式转移见 ensureHost。 */
  transferHost(requesterId: PlayerId, targetId: PlayerId, now: number): Result<void> {
    if (!this.isHost(requesterId)) return err('NOT_HOST');
    if (requesterId === targetId) return err('CANNOT_TARGET_SELF');
    const target = this.player(targetId);
    if (!target) return err('PLAYER_NOT_FOUND');
    if (target.isBot) return err('PLAYER_NOT_FOUND'); // bot 永不做 host
    this.setHost(targetId);
    this.touch(now);
    return OK;
  }

  private setHost(id: PlayerId): void {
    this.hostId = id;
    for (const p of this.players) p.isHost = p.id === id;
  }

  /** host 离开后把 host 交给剩下的**真人**。bot 永不继承(通用面 #4)。 */
  private ensureHost(): void {
    if (this.players.some((p) => p.id === this.hostId)) return;
    const heir = this.players.find((p) => !p.isBot);
    if (heir) this.setHost(heir.id);
  }

  private releaseSeatsOf(id: PlayerId): void {
    if (this.oracleId === id) this.oracleId = null;
  }

  setReady(id: PlayerId, ready: boolean, now: number): Result<void> {
    const p = this.player(id);
    if (!p) return err('NOT_IN_ROOM');
    if (this.phase !== 'lobby') return err('NOT_LOBBY_PHASE');
    p.isReady = ready;
    this.touch(now);
    return OK;
  }

  /** 改名。ADR-10 的 reroll 入口落在 lobby 内,不是首屏关卡。 */
  setNickname(id: PlayerId, name: string, now: number): Result<void> {
    const p = this.player(id);
    if (!p) return err('NOT_IN_ROOM');
    p.nickname = rerollUniqueName(
      this.players.filter((o) => o.id !== id).map((o) => o.nickname),
      name,
    );
    this.touch(now);
    return OK;
  }

  /* ─────────────────────── settings ────────────────────── */

  /** SPEC §4:host-only,**仅 lobby phase 可改**。 */
  updateSettings(
    requesterId: PlayerId,
    patch: Partial<RoomSettings>,
    now: number,
  ): Result<void> {
    if (!this.isHost(requesterId)) return err('NOT_HOST');
    if (this.phase !== 'lobby') return err('NOT_LOBBY_PHASE');

    const next: RoomSettings = { ...this.settings };

    if (patch.puzzleType !== undefined) {
      if (!isPuzzleTypeId(patch.puzzleType)) return err('INVALID_SETTINGS');
      next.puzzleType = patch.puzzleType;
      // 换类型 → 额度回落到 config 表的默认值。差异只经由表,这里没有 if(type)。
      next.budget = puzzleConfig(patch.puzzleType).defaultBudget;
    }

    if (patch.budget !== undefined) {
      const allowsBudget = puzzleConfig(next.puzzleType).defaultBudget !== null;
      if (!allowsBudget) {
        next.budget = null; // 该类型无额度概念,钉死为 null
      } else {
        if (typeof patch.budget !== 'number' || !Number.isInteger(patch.budget)) {
          return err('INVALID_SETTINGS');
        }
        next.budget = clamp(patch.budget, 1, 99);
      }
    }

    if (patch.pendingCap !== undefined) {
      if (typeof patch.pendingCap !== 'number') return err('INVALID_SETTINGS');
      next.pendingCap = clamp(
        Math.trunc(patch.pendingCap),
        GAME_META.pendingCapMin,
        GAME_META.pendingCapMax,
      );
    }

    if (patch.maxPlayers !== undefined) {
      if (typeof patch.maxPlayers !== 'number') return err('INVALID_SETTINGS');
      const wanted = clamp(
        Math.trunc(patch.maxPlayers),
        GAME_META.minPlayers,
        GAME_META.maxPlayersLimit,
      );
      // 不允许压到当前人数以下 —— 否则要定义踢谁,而那不是设置项该干的事。
      if (wanted < this.players.length) return err('INVALID_SETTINGS');
      next.maxPlayers = wanted;
    }

    if (patch.isPrivate !== undefined) {
      if (typeof patch.isPrivate !== 'boolean') return err('INVALID_SETTINGS');
      next.isPrivate = patch.isPrivate;
    }

    this.settings = next;
    this.touch(now);
    return OK;
  }

  /**
   * 双轨寻址的维持点:转私密立刻收回号,转公开时重新发号。
   * 私密房**永远**不带号(通用面 #7)。
   */
  applyPrivacy(allocateNumber: () => number, freeNumber: (n: number) => void): void {
    if (this.settings.isPrivate) {
      if (this.displayNumber !== null) {
        freeNumber(this.displayNumber);
        this.displayNumber = null;
      }
    } else if (this.displayNumber === null) {
      this.displayNumber = allocateNumber();
    }
  }

  /* ─────────────────── oracle seat (SPEC §2) ─────────────────── */

  /**
   * 上位。**先到先得**:座位有人就拒,不排队、不抢占。
   * 同步执行 = 两个并发申领之间没有交错窗口,后到者必然收 SEAT_TAKEN。
   * 「在座 guesser 可直接切换上位」= 一步动作 —— guesser 本来就没有要先腾的座位。
   */
  claimOracle(requesterId: PlayerId, now: number): Result<void> {
    if (!this.has(requesterId)) return err('NOT_IN_ROOM');
    if (this.phase !== 'lobby') return err('NOT_LOBBY_PHASE');
    if (this.oracleId === requesterId) return OK; // 幂等,不算错
    if (this.oracleId !== null) return err('SEAT_TAKEN');
    this.oracleId = requesterId;
    this.touch(now);
    return OK;
  }

  /** 下位。让位的两条路之一(另一条是 host 改派)。**无 swap request。** */
  releaseOracle(requesterId: PlayerId, now: number): Result<void> {
    if (!this.isOracle(requesterId)) return err('NOT_ORACLE');
    if (this.phase !== 'lobby') return err('NOT_LOBBY_PHASE');
    this.oracleId = null;
    this.touch(now);
    return OK;
  }

  /**
   * host 指派 / 改派 —— **可以覆盖已占的座位**(这是 host 的权力,不是竞争)。
   * `targetId === null` = 清空座位。
   * SPEC §7 的「oracle 接管」将来复用这条路径,且不限 lobby phase;
   * scaffold 阶段中段 phase 还是空壳,所以暂不放行非 lobby。
   */
  assignOracle(requesterId: PlayerId, targetId: PlayerId | null, now: number): Result<void> {
    if (!this.isHost(requesterId)) return err('NOT_HOST');
    if (this.phase !== 'lobby') return err('NOT_LOBBY_PHASE');
    if (targetId !== null && !this.has(targetId)) return err('PLAYER_NOT_FOUND');
    this.oracleId = targetId;
    this.touch(now);
    return OK;
  }

  /* ────────────────────── phase (SPEC §3) ───────────────────── */

  /**
   * Start gate:oracle 在位 **且** 全员 ready **且** 人数 ≥ 2(1 oracle + ≥1 guesser)。
   * 三个条件各有各的错误码 —— client 才能告诉玩家到底缺哪一样。
   *
   * 「全员」**按 SPEC §3 的字面执行 —— 包括 oracle 自己。**
   * (实现时想过「坐上座位即等于 ready」的豁免,但那是 SPEC 没写的解释。
   *  UX 上是否值得豁免记在 NOTES,等真实朋友局的观察,不在这里自作主张。)
   */
  startGateError(): ErrorCode | null {
    if (this.players.length < GAME_META.minPlayers) return 'NOT_ENOUGH_PLAYERS';
    if (this.oracleId === null) return 'NO_ORACLE_SEATED';
    if (!this.players.every((p) => p.isReady)) return 'NOT_ALL_READY';
    return null;
  }

  /** lobby → setup。中段 phase 的内容是下一个 session 的事,这里只翻牌。 */
  startGame(requesterId: PlayerId, now: number): Result<void> {
    if (!this.isHost(requesterId)) return err('NOT_HOST');
    if (!canTransition(this.phase, 'setup')) return err('NOT_LOBBY_PHASE');
    const gate = this.startGateError();
    if (gate) return err(gate);
    this.phase = 'setup';
    this.touch(now);
    return OK;
  }

  /* ───────────────────── projections ──────────────────── */

  /**
   * 通用面 #6 —— **whitelist,不是脱敏。**
   * 字段在这里被逐个列举,所以将来加进 Room 的任何东西(汤底、答案词、队列)
   * **不可能**意外出现在 lobby 列表里。往这个投影里加字段 = 一次明确的决定。
   */
  toSummary(): RoomSummary {
    return {
      code: this.code,
      displayNumber: this.displayNumber,
      phase: this.phase,
      playerCount: this.players.length,
      maxPlayers: this.settings.maxPlayers,
      puzzleType: this.settings.puzzleType,
      hasOracle: this.oracleId !== null,
      hostNickname: this.player(this.hostId)?.nickname ?? '',
    };
  }

  /**
   * 机制通用,**遮蔽策略是游戏规则**。
   * scaffold 阶段还没有可遮的东西(题目/汤底/答案词下个 session 才进 Room)——
   * 加它们的时候,**遮蔽必须发生在这里**,不是在 client 侧隐藏。
   */
  toClientState(viewerId: PlayerId): RoomState {
    return {
      code: this.code,
      displayNumber: this.displayNumber,
      phase: this.phase,
      players: this.players.map((p) => ({ ...p })),
      hostId: this.hostId,
      oracleId: this.oracleId,
      settings: { ...this.settings },
      viewerId,
    };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
