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
  JUDGING_LIMITS,
  type Question,
  type RoundOutcome,
  type Submission,
} from '@shared/judging';
import { PUZZLE_LIMITS, type PublicPuzzle, type PuzzleDraft, type PuzzleListItem, type SituationPuzzle } from '@shared/puzzles';
import {
  DEFAULT_PUZZLE_TYPE,
  isPuzzleTypeId,
  puzzleConfig,
  type Answer,
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

/**
 * 题库端口。**Room 不认识 data/ 里的 json**,只认识这个接口 ——
 * 于是 Room 可以脱离题库单测,题库也可以脱离 Room 单测。
 */
export interface BankPort {
  /** 防剧透投影 + 已用过滤。 */
  list(used: ReadonlySet<string>): PuzzleListItem[];
  find(id: string): SituationPuzzle | undefined;
}

/** 无题库的默认实现。20Q 用的就是它,不需要任何分支。 */
const EMPTY_BANK: BankPort = { list: () => [], find: () => undefined };

export interface RoomInit {
  code: RoomCode;
  displayNumber: number | null;
  host: { id: PlayerId; nickname: string };
  isPrivate: boolean;
  now: number;
  /** 不给就是空题库 —— 单测里几乎总是不给。 */
  bank?: BankPort;
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

  /**
   * oracle 录好的题。setup 里被填,reveal 之后清。
   * **`truth` 只经由 toClientState 发给 oracle** —— 别在别处读它往外发。
   */
  puzzle: PuzzleDraft | null = null;

  /**
   * 防剧透三件套之三:per-room 已用题 Set。
   * **内存,零持久化(ADR-12)** —— 房间没了就没了,跨 session 追踪是 auth 时代的事。
   * 注意:换一题之后这题**仍然算用过**,不退回列表。
   */
  readonly usedPuzzleIds = new Set<string>();

  /* ─── playing:判定循环(SPEC §5)。全部随 resetForNextRound 归零 ─── */

  /** 未判的,FIFO。**严格判队首** —— 批量判定 v1 不做。 */
  queue: Question[] = [];
  /** 已判的,按判定顺序。 */
  history: Question[] = [];
  /** 海龟汤的还原提交。 */
  submissions: Submission[] = [];
  /**
   * 全房共享额度。**入队即扣**;无额度的类型恒为 null。
   * 进 playing 时从 settings.budget 取,所以第二局拿到的是满额度而不是上局余额。
   */
  budgetLeft: number | null = null;
  /** 收束结果。非 null = 这一局结束了。 */
  outcome: RoundOutcome | null = null;
  /** 本局开始计时的锚点,用来算 durationMs。 */
  private playingStartedAt = 0;
  private seq = 0;

  private readonly bank: BankPort;

  constructor(init: RoomInit) {
    this.bank = init.bank ?? EMPTY_BANK;
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

  /* ─────────────────── setup:录题(SPEC §6)─────────────────── */

  /** 录题的三个入口共用的守卫:必须是 oracle、必须在 setup、题不能已经录好。 */
  private canRecord(requesterId: PlayerId): ErrorCode | null {
    if (!this.isOracle(requesterId)) return 'NOT_ORACLE';
    if (this.phase !== 'setup') return 'NOT_SETUP_PHASE';
    if (this.puzzle !== null) return 'PUZZLE_ALREADY_SET';
    return null;
  }

  /**
   * 从题库选题。题目经由注入的 BankPort 取,Room 不认识 data/。
   *
   * 确认选定的**那一刻**:汤面对全房公开,汤底只对 oracle 展开,题记入已用 Set。
   */
  selectBankPuzzle(requesterId: PlayerId, puzzleId: string, now: number): Result<void> {
    const guard = this.canRecord(requesterId);
    if (guard) return err(guard);
    if (!this.hasBank()) return err('BANK_NOT_AVAILABLE');
    if (this.usedPuzzleIds.has(puzzleId)) return err('PUZZLE_ALREADY_USED');

    const found = this.bank.find(puzzleId);
    if (!found) return err('PUZZLE_NOT_FOUND');

    this.puzzle = {
      source: 'bank',
      bankId: found.id,
      title: found.title,
      surface: found.surface,
      truth: found.truth,
    };
    this.usedPuzzleIds.add(found.id);
    this.touch(now);
    return OK;
  }

  /**
   * 自写题(海龟汤:汤面 + 汤底两栏)/ 20Q 的答案词(surface 传 null)。
   * 两者是**同一条路径** —— 差异只是 surface 有没有,不需要判类型。
   */
  setCustomPuzzle(
    requesterId: PlayerId,
    input: { surface?: string | null; truth?: unknown; title?: string | null },
    now: number,
  ): Result<void> {
    const guard = this.canRecord(requesterId);
    if (guard) return err(guard);

    const truth = trimmed(input.truth);
    if (!truth) return err('INVALID_PUZZLE');

    const wantsSurface = this.hasBank();
    const surface = trimmed(input.surface);

    // 有题库的类型(海龟汤)必须给汤面;没题库的(20Q)不接受汤面。
    if (wantsSurface && !surface) return err('INVALID_PUZZLE');

    const maxTruth = wantsSurface ? PUZZLE_LIMITS.truthMax : PUZZLE_LIMITS.answerWordMax;
    if (truth.length > maxTruth) return err('INVALID_PUZZLE');
    if (surface && surface.length > PUZZLE_LIMITS.surfaceMax) return err('INVALID_PUZZLE');

    const title = trimmed(input.title);
    if (title && title.length > PUZZLE_LIMITS.titleMax) return err('INVALID_PUZZLE');

    this.puzzle = {
      source: 'own',
      bankId: null,
      title: title ?? null,
      surface: wantsSurface ? surface : null,
      truth,
    };
    this.touch(now);
    return OK;
  }

  /** 换一题:清掉已录的。**已用的仍然算用过**,不退回列表。 */
  clearPuzzle(requesterId: PlayerId, now: number): Result<void> {
    if (!this.isOracle(requesterId)) return err('NOT_ORACLE');
    if (this.phase !== 'setup') return err('NOT_SETUP_PHASE');
    this.puzzle = null;
    this.touch(now);
    return OK;
  }

  /** 开汤(海龟汤)/ 锁定开局(20Q):setup → playing。题没录好不许走。 */
  beginPlaying(requesterId: PlayerId, now: number): Result<void> {
    if (!this.isOracle(requesterId)) return err('NOT_ORACLE');
    if (!canTransition(this.phase, 'playing')) return err('NOT_SETUP_PHASE');
    if (this.puzzle === null) return err('NO_PUZZLE_SET');
    this.phase = 'playing';
    // 额度在这里才装填 —— 取 settings 而不是接着上一局的余额。
    this.budgetLeft = this.settings.budget;
    this.playingStartedAt = now;
    this.touch(now);
    return OK;
  }

  /** 这个房间当前的 puzzle type 有没有题库 —— **读 config 表,不判类型**。 */
  hasBank(): boolean {
    return puzzleConfig(this.settings.puzzleType).hasBank;
  }

  /** 本房还能选的题(已用的不出现)。无题库的类型恒为空。 */
  availablePuzzles(): PuzzleListItem[] {
    return this.hasBank() ? this.bank.list(this.usedPuzzleIds) : [];
  }

  /* ═══════════════ playing:判定循环(SPEC §5)═══════════════ */

  /** 这个 puzzle type 允许的判定值 —— **读 config 表**,不判类型。 */
  private allowedAnswers(): readonly Answer[] {
    return puzzleConfig(this.settings.puzzleType).answers;
  }

  /** 有没有独立的「提交还原」通道。同样只看表。 */
  hasSubmissionChannel(): boolean {
    return puzzleConfig(this.settings.puzzleType).guessMode === 'submission';
  }

  /** 某人手上还有几条未判的问题。**只数 queue,不数还原。** */
  pendingCountOf(id: PlayerId): number {
    return this.queue.reduce((n, q) => (q.askerId === id ? n + 1 : n), 0);
  }

  /**
   * 入队提问。
   *
   * **两道闸各管各的:**
   *   · pending cap —— 被它拦住时**不扣额度**(所以先查它);
   *   · 额度       —— 通过之后才扣,扣了就不退。
   * 顺序反了会出现「被 cap 拒了却掉了一点额度」这种静默错账。
   */
  askQuestion(requesterId: PlayerId, text: unknown, now: number): Result<Question> {
    if (this.phase !== 'playing') return err('NOT_PLAYING_PHASE');
    if (!this.has(requesterId)) return err('NOT_IN_ROOM');
    if (this.isOracle(requesterId)) return err('ORACLE_CANNOT_ASK');

    const body = trimmed(text);
    if (!body || body.length > JUDGING_LIMITS.questionMax) return err('INVALID_PAYLOAD');

    if (this.pendingCountOf(requesterId) >= this.settings.pendingCap) {
      return err('PENDING_CAP_REACHED');
    }
    // 额度是**入队许可证**:归零后进不来,但已经在队里的照判。
    if (this.budgetLeft !== null && this.budgetLeft <= 0) return err('NO_BUDGET_LEFT');

    const q: Question = {
      id: `q${++this.seq}`,
      askerId: requesterId,
      text: body,
      askedAt: now,
      answer: null,
      answeredAt: null,
      corrected: false,
      previousAnswer: null,
    };
    this.queue.push(q);
    if (this.budgetLeft !== null) this.budgetLeft -= 1; // ← 入队即扣
    this.touch(now);
    return ok(q);
  }

  /** 判队首。**严格 FIFO**,不能挑。 */
  judge(requesterId: PlayerId, answer: Answer, now: number): Result<Question> {
    if (!this.isOracle(requesterId)) return err('NOT_ORACLE');
    if (this.phase !== 'playing') return err('NOT_PLAYING_PHASE');
    if (!this.allowedAnswers().includes(answer)) return err('ANSWER_NOT_ALLOWED');

    const q = this.queue.shift();
    if (!q) return err('QUEUE_EMPTY');

    q.answer = answer;
    q.answeredAt = now;
    this.history.push(q);
    this.touch(now);

    this.settleAfterJudgement(q, now);
    return ok(q);
  }

  /**
   * 对**最近一条**已判问题重判一次。
   * 只限最近一条、只限一次 —— 防翻旧账把推理链搅乱(SPEC §5)。
   */
  correctLast(requesterId: PlayerId, answer: Answer, now: number): Result<Question> {
    if (!this.isOracle(requesterId)) return err('NOT_ORACLE');
    if (this.phase !== 'playing') return err('NOT_PLAYING_PHASE');
    if (!this.allowedAnswers().includes(answer)) return err('ANSWER_NOT_ALLOWED');

    const last = this.history[this.history.length - 1];
    if (!last) return err('NOTHING_TO_CORRECT');
    if (last.corrected) return err('ALREADY_CORRECTED');

    last.previousAnswer = last.answer;
    last.answer = answer;
    last.corrected = true;
    last.answeredAt = now;
    this.touch(now);

    // 改成 CORRECT 一样要收束 —— 改错不是绕过收束的后门。
    this.settleAfterJudgement(last, now);
    return ok(last);
  }

  /**
   * 一次判定之后的收束检查。两种结束方式:
   *   · CORRECT   → 命中,提问者记为命中者;
   *   · 额度归零 + 队列判空 + 没命中 → guessers 失败。
   */
  private settleAfterJudgement(q: Question, now: number): void {
    if (q.answer === 'CORRECT') {
      this.converge('hit', q.askerId, 'judgment', now);
      return;
    }
    if (this.budgetLeft !== null && this.budgetLeft <= 0 && this.queue.length === 0) {
      this.converge('exhausted', null, null, now);
    }
  }

  /* ─────────── 海龟汤:提交还原(独立通道)─────────── */

  /**
   * 提交还原。**不占 pending cap** —— 它有自己那条「每人最多 1 条未决」的账。
   * 内容全房可见(co-op 无泄题问题)。
   */
  submitSolution(requesterId: PlayerId, text: unknown, now: number): Result<Submission> {
    if (this.phase !== 'playing') return err('NOT_PLAYING_PHASE');
    if (!this.has(requesterId)) return err('NOT_IN_ROOM');
    if (this.isOracle(requesterId)) return err('ORACLE_CANNOT_ASK');
    if (!this.hasSubmissionChannel()) return err('SUBMISSION_NOT_AVAILABLE');

    const body = trimmed(text);
    if (!body || body.length > JUDGING_LIMITS.submissionMax) return err('INVALID_PAYLOAD');

    const hasPending = this.submissions.some(
      (x) => x.playerId === requesterId && x.status === 'pending',
    );
    if (hasPending) return err('SUBMISSION_PENDING');

    const sub: Submission = {
      id: `s${++this.seq}`,
      playerId: requesterId,
      text: body,
      submittedAt: now,
      status: 'pending',
      resolvedAt: null,
    };
    this.submissions.push(sub);
    this.touch(now);
    return ok(sub);
  }

  /** accept → 命中收束;reject → 继续,**无任何消耗**。 */
  resolveSubmission(
    requesterId: PlayerId,
    submissionId: string,
    accept: boolean,
    now: number,
  ): Result<Submission> {
    if (!this.isOracle(requesterId)) return err('NOT_ORACLE');
    if (this.phase !== 'playing') return err('NOT_PLAYING_PHASE');

    const sub = this.submissions.find((x) => x.id === submissionId && x.status === 'pending');
    if (!sub) return err('SUBMISSION_NOT_FOUND');

    sub.status = accept ? 'accepted' : 'rejected';
    sub.resolvedAt = now;
    this.touch(now);

    if (accept) this.converge('hit', sub.playerId, 'submission', now);
    return ok(sub);
  }

  /**
   * oracle 主动「公开汤底 · 结束本局」→ 记为**未猜中**。
   * client 端必须先弹确认框(SPEC §5 防误触);server 只管执行。
   */
  revealTruth(requesterId: PlayerId, now: number): Result<void> {
    if (!this.isOracle(requesterId)) return err('NOT_ORACLE');
    if (this.phase !== 'playing') return err('NOT_PLAYING_PHASE');
    this.converge('revealed', null, null, now);
    return OK;
  }

  /**
   * 收束:playing → reveal。
   *
   * **真相在这里被快照进 outcome** —— 于是归位时可以放心清掉 puzzle,
   * reveal 屏仍然有东西可显示。
   */
  private converge(
    result: RoundOutcome['result'],
    winnerId: PlayerId | null,
    via: RoundOutcome['via'],
    now: number,
  ): void {
    this.outcome = {
      result,
      winnerId,
      questionsUsed: this.history.length + this.queue.length,
      durationMs: Math.max(0, now - this.playingStartedAt),
      truth: this.puzzle?.truth ?? '',
      via,
    };
    this.phase = 'reveal';
    this.touch(now);
  }

  /* ─────────── 归位:第二局不许带脏状态 ─────────── */

  /**
   * 清掉**这一局**的所有东西。
   *
   * 不动的:座位、host、玩家、设置,以及 **`usedPuzzleIds`** ——
   * 已用题跨局保留,同一晚不该重复出同一道题(SPEC §6)。
   */
  resetForNextRound(now: number): void {
    this.puzzle = null;
    this.queue = [];
    this.history = [];
    this.submissions = [];
    this.budgetLeft = null;
    this.outcome = null;
    this.playingStartedAt = 0;
    this.touch(now);
  }

  /**
   * reveal → setup(再来一局)。
   *
   * **出题人交接的策略(默认猜中者接棒 / 未猜中则 oracle 连任)属于 reveal 屏那一刀**,
   * 这里只做归位与相位翻转,不擅自改座位。
   */
  startNextRound(requesterId: PlayerId, now: number): Result<void> {
    if (!this.isHost(requesterId)) return err('NOT_HOST');
    if (!canTransition(this.phase, 'setup')) return err('NOT_REVEAL_PHASE');
    this.resetForNextRound(now);
    this.phase = 'setup';
    return OK;
  }

  /** reveal → lobby(改设置)。同样归位。 */
  backToLobby(requesterId: PlayerId, now: number): Result<void> {
    if (!this.isHost(requesterId)) return err('NOT_HOST');
    if (!canTransition(this.phase, 'lobby')) return err('NOT_REVEAL_PHASE');
    this.resetForNextRound(now);
    this.phase = 'lobby';
    for (const p of this.players) p.isReady = false;
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
   *
   * ⚠️ **这个方法是本游戏唯一的信息边界。** 汤底 / 答案词 / 选题列表都在这里被
   * 按收件人裁掉。裁错了不会抛异常、不会红屏 —— 只是所有人都看见了答案,
   * 而且没人会立刻发现。PROJECT_RIGOR §4 必测 1。
   *
   * 规则:
   *   · `puzzle`      公开面(题名 + 汤面)。全房可见。20Q 的 surface 是 null。
   *   · `oracleTruth` 汤底 / 答案词。**只有 oracle 那一份有值。**
   *   · `bank`        选题列表。**只有 oracle 那一份有值** —— 让 guesser 看见
   *                   候选题名本身就是剧透。
   */
  toClientState(viewerId: PlayerId): RoomState {
    const isOracle = this.isOracle(viewerId);
    return {
      code: this.code,
      displayNumber: this.displayNumber,
      phase: this.phase,
      players: this.players.map((p) => ({ ...p })),
      hostId: this.hostId,
      oracleId: this.oracleId,
      settings: { ...this.settings },
      viewerId,
      puzzle: this.puzzle ? publicFace(this.puzzle) : null,
      oracleTruth: isOracle ? (this.puzzle?.truth ?? null) : null,
      bank: isOracle && this.hasBank() ? this.availablePuzzles() : null,
      bankExhausted: this.hasBank() && this.availablePuzzles().length === 0,

      /*
       * 队列 / 历史 / 还原 / 额度都是**全房可见**的:co-op 共享同一条推理链,
       * 迟到的人也不该有信息差(SPEC §7)。这里没有可遮的东西 ——
       * 唯一的秘密仍然只有 truth,它只走 oracleTruth 和收束后的 outcome。
       */
      queue: this.queue.map((q) => ({ ...q })),
      history: this.history.map((q) => ({ ...q })),
      submissions: this.submissions.map((x) => ({ ...x })),
      budgetLeft: this.budgetLeft,
      myPendingLeft: Math.max(0, this.settings.pendingCap - this.pendingCountOf(viewerId)),
      outcome: this.outcome ? { ...this.outcome } : null,
    };
  }
}

/**
 * 题目的公开面。**truth 结构性缺席** —— 不是被删掉的,是从来没被放进来过。
 * 和 toSummary 同一个道理:将来给 PuzzleDraft 加字段,不会自动泄漏。
 */
function publicFace(p: PuzzleDraft): PublicPuzzle {
  return { title: p.title, surface: p.surface, ready: true };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** 收敛成 trim 过的非空字符串,拿不到就是 null。 */
function trimmed(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
