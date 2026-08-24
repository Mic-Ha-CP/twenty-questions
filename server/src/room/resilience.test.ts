/**
 * 房间韧性(smoke 第三轮带回)—— 人走人来的时候,局别塌。
 *
 * 两组:
 *   1. **中段转移的 gate** —— 2 人房里转移出题人是死路:换完之后唯一的猜题人
 *      就是刚刚还拿着汤底的那个人。必须挡在 server 侧,不能只靠 UI 藏按钮。
 *   2. **host 永久离开 → 宽限到期 → 移交** —— Michelle 实测的场景:
 *      房主在 reveal 阶段关掉页面再也没回来,房间不能就此卡死。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_META } from '@shared/meta';
import type { SituationPuzzle } from '@shared/puzzles';
import { Room, type BankPort } from './Room';
import { RoomManager } from './RoomManager';

const T0 = 1_000_000;

const P1: SituationPuzzle = { id: 'p1', title: '汤', surface: '汤面', truth: 'SECRET_TRUTH' };
const BANK: BankPort = {
  find: (id) => (id === 'p1' ? P1 : undefined),
  list: (used) => (used.has('p1') ? [] : [{ id: 'p1', title: '汤' }]),
};

/** 建房 + 指定人数的 guesser,推到 playing。 */
function playingRoom(guesserCount: number) {
  const r = new Room({
    code: '1234',
    displayNumber: 1,
    host: { id: 'host', nickname: 'H' },
    isPrivate: false,
    now: T0,
    bank: BANK,
  });
  const ids = ['host'];
  for (let i = 0; i < guesserCount; i++) {
    r.addPlayer(`g${i}`, `G${i}`, T0);
    ids.push(`g${i}`);
  }
  // host 兼任 oracle,剩下的都是 guesser
  r.claimOracle('host', T0);
  for (const id of ids) r.setReady(id, true, T0);
  const started = r.startGame('host', T0);
  if (!started.ok) throw new Error(`startGame: ${started.error}`);
  r.selectBankPuzzle('host', 'p1', T0);
  r.beginPlaying('host', T0);
  return r;
}

/* ═══════════════ 1. 中段转移的 gate ═══════════════ */

describe('中段转移 gate:2 人房不许转', () => {
  it('**2 人房(oracle + 1 guesser)中段转移被拒**', () => {
    const r = playingRoom(1); // host=oracle + g0
    expect(r.players).toHaveLength(2);

    // 转给唯一的猜题人 = 换完之后场上唯一的猜题人是刚放下汤底的那个
    expect(r.assignOracle('host', 'g0', T0)).toEqual({
      ok: false,
      error: 'TOO_FEW_FOR_TRANSFER',
    });
    expect(r.oracleId).toBe('host'); // 座位没动
  });

  it('2 人房中段也不许清空座位 —— 那会让局彻底没人判', () => {
    const r = playingRoom(1);
    expect(r.assignOracle('host', null, T0)).toEqual({
      ok: false,
      error: 'TOO_FEW_FOR_TRANSFER',
    });
  });

  it('**3 人房中段可以转** —— 换完仍有一个没碰过汤底的猜题人', () => {
    const r = playingRoom(2); // host=oracle + g0 + g1
    expect(r.players).toHaveLength(3);
    expect(r.assignOracle('host', 'g0', T0).ok).toBe(true);
    expect(r.oracleId).toBe('g0');
  });

  it('gate 只看人数,不看谁是 host', () => {
    const r = playingRoom(2);
    r.transferHost('host', 'g1', T0); // host 换人,仍是 3 人
    expect(r.assignOracle('g1', 'g0', T0).ok).toBe(true);
  });

  it('**lobby 阶段不设这道 gate** —— 还没人知道任何东西', () => {
    const r = new Room({
      code: '1',
      displayNumber: 1,
      host: { id: 'host', nickname: 'H' },
      isPrivate: false,
      now: T0,
    });
    r.addPlayer('g0', 'G0', T0);
    expect(r.phase).toBe('lobby');
    expect(r.assignOracle('host', 'g0', T0).ok).toBe(true);
    expect(r.assignOracle('host', null, T0).ok).toBe(true);
  });

  it('setup / reveal 同样受 gate 管(只要不是 lobby)', () => {
    const r = playingRoom(1);
    r.revealTruth('host', T0);
    expect(r.phase).toBe('reveal');
    expect(r.assignOracle('host', 'g0', T0)).toEqual({
      ok: false,
      error: 'TOO_FEW_FOR_TRANSFER',
    });
  });

  it('人数掉到 2 之后,原本能转的房也转不动了', () => {
    const r = playingRoom(2);
    r.removePlayer('g1', T0);
    expect(r.players).toHaveLength(2);
    expect(r.assignOracle('host', 'g0', T0)).toEqual({
      ok: false,
      error: 'TOO_FEW_FOR_TRANSFER',
    });
  });

  it('`canTransferOracle()` 给 UI 用 —— 藏按钮和 server 判定用同一条规则', () => {
    expect(playingRoom(1).canTransferOracle()).toBe(false);
    expect(playingRoom(2).canTransferOracle()).toBe(true);
  });
});

/* ═══════════════ 2. host 永久离开 → 宽限 → 移交 ═══════════════ */

describe('host 在 reveal 阶段永久离开(Michelle 实测场景)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** 可控时钟的 manager + 一个已经收束到 reveal 的房。 */
  function revealRoom() {
    let now = T0;
    const m = new RoomManager(() => now, BANK);
    const created = m.create({ id: 'host', nickname: 'H' }, false);
    if (!created.ok) throw new Error('create failed');
    const r = created.value;
    r.addPlayer('g0', 'G0', now);
    r.addPlayer('g1', 'G1', now);
    r.claimOracle('g0', now);
    for (const id of ['host', 'g0', 'g1']) r.setReady(id, true, now);
    r.startGame('host', now);
    r.selectBankPuzzle('g0', 'p1', now);
    r.beginPlaying('g0', now);
    r.revealTruth('g0', now);
    return { m, r, advance: (ms: number) => { now += ms; }, at: () => now };
  }

  it('前置:房间确实停在 reveal,host 是 host', () => {
    const { r } = revealRoom();
    expect(r.phase).toBe('reveal');
    expect(r.hostId).toBe('host');
  });

  it('host 断线的当下**不移交** —— 先给宽限', () => {
    const { m, r, advance, at } = revealRoom();
    r.markDisconnected('host', at());
    m.startSweep();

    advance(GAME_META.disconnectGraceMs - 1000);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);

    expect(r.hostId).toBe('host'); // 还没到点
    expect(r.player('host')!.connected).toBe(false);
    m.stopSweep();
  });

  it('**宽限到期 → host 被移除 → host 自动移交给还在的人**', () => {
    const { m, r, advance, at } = revealRoom();
    r.markDisconnected('host', at());
    m.startSweep();

    advance(GAME_META.disconnectGraceMs + 1);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);

    expect(r.has('host')).toBe(false);
    expect(r.hostId).not.toBe('host');
    expect(['g0', 'g1']).toContain(r.hostId);
    expect(r.player(r.hostId)!.isHost).toBe(true);
    m.stopSweep();
  });

  it('**移交之后房间仍在 reveal,新 host 能开下一局**(不是死局)', () => {
    const { m, r, advance, at } = revealRoom();
    r.markDisconnected('host', at());
    m.startSweep();
    advance(GAME_META.disconnectGraceMs + 1);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);
    m.stopSweep();

    expect(r.phase).toBe('reveal');
    const newHost = r.hostId;
    expect(r.startNextRound(newHost, at()).ok).toBe(true);
    expect(r.phase).toBe('setup');
  });

  it('新 host 也能选择回大厅', () => {
    const { m, r, advance, at } = revealRoom();
    r.markDisconnected('host', at());
    m.startSweep();
    advance(GAME_META.disconnectGraceMs + 1);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);
    m.stopSweep();

    expect(r.backToLobby(r.hostId, at()).ok).toBe(true);
    expect(r.phase).toBe('lobby');
  });

  it('**旧 host 的权限立刻失效** —— 就算它的 socket 又回来了', () => {
    const { m, r, advance, at } = revealRoom();
    r.markDisconnected('host', at());
    m.startSweep();
    advance(GAME_META.disconnectGraceMs + 1);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);
    m.stopSweep();

    expect(r.startNextRound('host', at())).toEqual({ ok: false, error: 'NOT_HOST' });
  });

  it('离开的人如果正好是 oracle,座位也一并空出来', () => {
    const { m, r, advance, at } = revealRoom();
    expect(r.oracleId).toBe('g0');
    r.markDisconnected('g0', at());
    m.startSweep();
    advance(GAME_META.disconnectGraceMs + 1);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);
    m.stopSweep();

    expect(r.has('g0')).toBe(false);
    expect(r.oracleId).toBeNull();
  });

  it('人走光了房间会被拆,而不是留一个空壳', () => {
    const { m, r, advance, at } = revealRoom();
    for (const id of ['host', 'g0', 'g1']) r.markDisconnected(id, at());
    m.startSweep();
    advance(GAME_META.disconnectGraceMs + 1);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);

    expect(m.byCode(r.code)).toBeUndefined();
    m.stopSweep();
  });
});

/* ═══════════════ 3. 离开 / 离线在投影里可见 ═══════════════ */

describe('离开与离线,全房可见', () => {
  it('断线的人仍在 players 里,带 connected=false —— 各屏据此画徽章', () => {
    const r = playingRoom(2);
    r.markDisconnected('g0', T0);

    for (const viewer of ['host', 'g1']) {
      const p = r.toClientState(viewer).players.find((x) => x.id === 'g0')!;
      expect(p.connected).toBe(false);
      expect(p.disconnectedAt).toBe(T0);
    }
  });

  it('主动离开的人直接从 players 里消失', () => {
    const r = playingRoom(2);
    r.removePlayer('g0', T0);
    expect(r.toClientState('host').players.map((p) => p.id)).not.toContain('g0');
  });

  it('**oracle 主动离开 = 座位空出来**(触发接管路径,不是把局锁死)', () => {
    const r = playingRoom(2);
    expect(r.oracleId).toBe('host');
    r.removePlayer('host', T0);

    expect(r.oracleId).toBeNull();
    expect(r.phase).toBe('playing'); // 局还在,等 host 指派新 oracle
    expect(r.hostId).not.toBe('host'); // host 也移交了
  });
});
