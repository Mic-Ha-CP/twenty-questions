/**
 * Room —— 房间层 + oracle 座位的单元测试。
 *
 * 覆盖 PROJECT_RIGOR §4 的必测项 2(toSummary whitelist)、5(phase 机 + start gate)、
 * 7(座位申领串行化)。测的是**会静默错**的那些:错了不抛异常、不红屏,
 * 只是游戏悄悄玩坏。
 */

import { describe, expect, it } from 'vitest';
import { GAME_META } from '@shared/meta';
import type { RoomSummary } from '@shared/types';
import { Room } from './Room';

const T0 = 1_000_000;

function room(opts: { isPrivate?: boolean } = {}): Room {
  return new Room({
    code: '1234',
    displayNumber: 1,
    host: { id: 'host', nickname: '沉默的侦探' },
    isPrivate: opts.isPrivate ?? false,
    now: T0,
  });
}

/** 建一个 host + n 个 guesser 都已入座的房。 */
function roomWith(n: number): Room {
  const r = room();
  for (let i = 0; i < n; i++) r.addPlayer(`p${i}`, `玩家${i}`, T0);
  return r;
}

describe('构造与基本不变量', () => {
  it('建房时 host 在座、oracle 位是空的、phase 是 lobby', () => {
    const r = room();
    expect(r.players).toHaveLength(1);
    expect(r.isHost('host')).toBe(true);
    expect(r.oracleId).toBeNull(); // ← host ≠ oracle,两权分离
    expect(r.phase).toBe('lobby');
  });

  it('私密房永远不带 displayNumber —— 顺序号会让未列出的房可被枚举', () => {
    expect(room({ isPrivate: true }).displayNumber).toBeNull();
    expect(room({ isPrivate: false }).displayNumber).toBe(1);
  });

  it('settings 的 budget 来自 config 表,不是硬编码', () => {
    const r = room();
    // 默认是海龟汤 → 无额度
    expect(r.settings.puzzleType).toBe('situation');
    expect(r.settings.budget).toBeNull();
  });
});

describe('oracle 座位:先到先得(必测 7)', () => {
  it('空座 → 第一个申领者坐上', () => {
    const r = roomWith(2);
    expect(r.claimOracle('p0', T0)).toEqual({ ok: true, value: undefined });
    expect(r.oracleId).toBe('p0');
  });

  it('**后到者收 SEAT_TAKEN,且座位不被抢走**', () => {
    const r = roomWith(2);
    r.claimOracle('p0', T0);

    const second = r.claimOracle('p1', T0);

    expect(second).toEqual({ ok: false, error: 'SEAT_TAKEN' });
    expect(r.oracleId).toBe('p0'); // ← 关键:失败的申领不能有副作用
  });

  it('同步执行 = 并发申领之间没有交错窗口:N 个申领只有 1 个成功', () => {
    const r = roomWith(5);
    // 同一 tick 内全部申领 —— 这正是 socket handler 的执行方式(方法体内不 await)
    const results = ['p0', 'p1', 'p2', 'p3', 'p4'].map((id) => r.claimOracle(id, T0));

    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.filter((x) => !x.ok)).toHaveLength(4);
    expect(results.filter((x) => !x.ok && x.error === 'SEAT_TAKEN')).toHaveLength(4);
    expect(r.oracleId).toBe('p0'); // 先到的那个
  });

  it('重复申领自己已占的座位是幂等的,不算错', () => {
    const r = roomWith(1);
    r.claimOracle('p0', T0);
    expect(r.claimOracle('p0', T0).ok).toBe(true);
    expect(r.oracleId).toBe('p0');
  });

  it('不在房里的人不能申领', () => {
    const r = roomWith(1);
    expect(r.claimOracle('陌生人', T0)).toEqual({ ok: false, error: 'NOT_IN_ROOM' });
  });

  it('下位只有 oracle 自己能做;别人来是 NOT_ORACLE', () => {
    const r = roomWith(2);
    r.claimOracle('p0', T0);
    expect(r.releaseOracle('p1', T0)).toEqual({ ok: false, error: 'NOT_ORACLE' });
    expect(r.releaseOracle('p0', T0).ok).toBe(true);
    expect(r.oracleId).toBeNull();
  });

  it('host 指派可以**覆盖**已占的座位(这是权力,不是竞争)', () => {
    const r = roomWith(2);
    r.claimOracle('p0', T0);
    expect(r.assignOracle('host', 'p1', T0).ok).toBe(true);
    expect(r.oracleId).toBe('p1');
  });

  it('host 指派 null = 清空座位;非 host 指派被拒', () => {
    const r = roomWith(2);
    r.claimOracle('p0', T0);
    expect(r.assignOracle('p1', 'p1', T0)).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(r.assignOracle('host', null, T0).ok).toBe(true);
    expect(r.oracleId).toBeNull();
  });

  it('oracle 离开房间 → 座位自动空出来', () => {
    const r = roomWith(2);
    r.claimOracle('p0', T0);
    r.removePlayer('p0', T0);
    expect(r.oracleId).toBeNull();
  });

  /**
   * ⚠️ 这条断言在 session 1/2 是反的(那时 `assignOracle` 限 lobby,故意没放行)。
   * session 4 落地 SPEC §7 的「oracle 接管」后**主动解除**了那道限制 ——
   * 不是实现漂移,是那个约束到期了。中段接管的完整用例在 `handoff.test.ts`。
   */
  it('assignOracle 中段也放行 —— SPEC §7 的 oracle 接管', () => {
    // 3 人:session 5.5 起中段转移有人数 gate(2 人房换完就没有干净的猜题人了),
    // 完整的 gate 用例在 resilience.test.ts。
    const r = roomWith(2);
    r.claimOracle('p0', T0);
    for (const id of ['host', 'p0', 'p1']) r.setReady(id, true, T0);
    r.startGame('host', T0);
    expect(r.phase).toBe('setup');
    expect(r.assignOracle('host', 'host', T0).ok).toBe(true);
    expect(r.oracleId).toBe('host');
  });
});

describe('start gate 三条件(必测 5)', () => {
  it('人不够 → NOT_ENOUGH_PLAYERS', () => {
    const r = room(); // 只有 host
    expect(r.startGateError()).toBe('NOT_ENOUGH_PLAYERS');
    expect(r.startGame('host', T0)).toEqual({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
  });

  it('没人坐 oracle → NO_ORACLE_SEATED', () => {
    const r = roomWith(1);
    r.setReady('host', true, T0);
    r.setReady('p0', true, T0);
    expect(r.startGateError()).toBe('NO_ORACLE_SEATED');
  });

  it('有人没 ready → NOT_ALL_READY', () => {
    const r = roomWith(1);
    r.claimOracle('p0', T0);
    r.setReady('p0', true, T0);
    // host 没 ready
    expect(r.startGateError()).toBe('NOT_ALL_READY');
  });

  it('**「全员」按 SPEC §3 字面执行 —— 含 oracle 自己**(NOTES 待决 #6)', () => {
    const r = roomWith(1);
    r.claimOracle('p0', T0);
    r.setReady('host', true, T0);
    // oracle p0 自己没 ready
    expect(r.startGateError()).toBe('NOT_ALL_READY');

    r.setReady('p0', true, T0);
    expect(r.startGateError()).toBeNull();
  });

  it('三条件齐 → lobby 翻到 setup', () => {
    const r = roomWith(1);
    r.claimOracle('p0', T0);
    r.setReady('host', true, T0);
    r.setReady('p0', true, T0);
    expect(r.startGame('host', T0).ok).toBe(true);
    expect(r.phase).toBe('setup');
  });

  it('只有 host 能开局', () => {
    const r = roomWith(1);
    r.claimOracle('p0', T0);
    r.setReady('host', true, T0);
    r.setReady('p0', true, T0);
    expect(r.startGame('p0', T0)).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(r.phase).toBe('lobby');
  });

  it('minPlayers 跟着 meta.ts 走,不是写死的 2', () => {
    expect(GAME_META.minPlayers).toBe(2);
  });
});

describe('toSummary 是 whitelist,不是脱敏(必测 2)', () => {
  /** 投影允许出现的**全部**字段。加字段必须是一次明确的决定。 */
  const ALLOWED: ReadonlyArray<keyof RoomSummary> = [
    'code',
    'displayNumber',
    'phase',
    'playerCount',
    'maxPlayers',
    'puzzleType',
    'hasOracle',
    'hostNickname',
  ];

  it('恰好 8 个字段,一个不多一个不少', () => {
    const keys = Object.keys(roomWith(2).toSummary()).sort();
    expect(keys).toEqual([...ALLOWED].sort());
    expect(keys).toHaveLength(8);
  });

  it('**往 Room 上塞一个新字段,它不会出现在 lobby 行里**', () => {
    const r = roomWith(2);
    // 模拟下个 session 往 Room 加汤底 / 答案词 / 队列
    (r as unknown as Record<string, unknown>).truth = '汤底不能泄漏';
    (r as unknown as Record<string, unknown>).answerWord = '长颈鹿';
    (r as unknown as Record<string, unknown>).queue = ['问题1'];

    const summary = JSON.stringify(r.toSummary());

    expect(summary).not.toContain('汤底不能泄漏');
    expect(summary).not.toContain('长颈鹿');
    expect(summary).not.toContain('问题1');
    expect(Object.keys(r.toSummary())).toHaveLength(8); // 结构性缺席,不是被过滤掉
  });

  it('只发「有没有 oracle」,不发是谁', () => {
    const r = roomWith(2);
    r.claimOracle('p0', T0);
    const s = r.toSummary();
    expect(s.hasOracle).toBe(true);
    expect(JSON.stringify(s)).not.toContain('p0');
  });
});

describe('toClientState per-viewer 投影', () => {
  it('每个人拿到的 viewerId 是自己的 —— client 靠它判角色,不靠猜', () => {
    const r = roomWith(1);
    expect(r.toClientState('host').viewerId).toBe('host');
    expect(r.toClientState('p0').viewerId).toBe('p0');
  });

  it('players 是拷贝,外部改不动房间内部状态', () => {
    const r = roomWith(1);
    const state = r.toClientState('host');
    state.players[0]!.nickname = '被篡改';
    expect(r.players[0]!.nickname).not.toBe('被篡改');
  });
});

describe('撞名 server 端重摇', () => {
  it('同房重名会被重摇成不一样的名字', () => {
    const r = room(); // host 叫「沉默的侦探」
    r.addPlayer('p0', '沉默的侦探', T0);
    expect(r.players[1]!.nickname).not.toBe('沉默的侦探');
  });

  it('**identity 是 playerId,不是名字** —— 重摇之后 id 不动', () => {
    const r = room();
    r.addPlayer('p0', '沉默的侦探', T0);
    expect(r.players[1]!.id).toBe('p0');
  });

  it('不撞名就原样保留', () => {
    const r = room();
    r.addPlayer('p0', '多疑的证人', T0);
    expect(r.players[1]!.nickname).toBe('多疑的证人');
  });

  it('房内改名同样避让别人', () => {
    const r = room();
    r.addPlayer('p0', '多疑的证人', T0);
    r.setNickname('p0', '沉默的侦探', T0); // 撞 host
    expect(r.player('p0')!.nickname).not.toBe('沉默的侦探');
  });
});

describe('断线:标记不移除(必测 9 的一半)', () => {
  it('断线只是打标记,人还在房里', () => {
    const r = roomWith(1);
    r.markDisconnected('p0', T0);
    expect(r.players).toHaveLength(2);
    expect(r.player('p0')!.connected).toBe(false);
    expect(r.player('p0')!.disconnectedAt).toBe(T0);
  });

  it('重连把稳定 playerId 重新绑上来,不当新人', () => {
    const r = roomWith(1);
    r.markDisconnected('p0', T0);
    const again = r.addPlayer('p0', '随便什么名', T0 + 1000);
    expect(again.ok).toBe(true);
    expect(r.players).toHaveLength(2); // 没有多出一个人
    expect(r.player('p0')!.connected).toBe(true);
    expect(r.player('p0')!.disconnectedAt).toBeNull();
  });

  it('宽限内不算过期,超过才算', () => {
    const r = roomWith(1);
    r.markDisconnected('p0', T0);
    expect(r.expiredDisconnects(T0 + GAME_META.disconnectGraceMs - 1)).toEqual([]);
    expect(r.expiredDisconnects(T0 + GAME_META.disconnectGraceMs + 1)).toEqual(['p0']);
  });

  it('在线的人永远不会被算成过期', () => {
    const r = roomWith(1);
    expect(r.expiredDisconnects(T0 + 10 * GAME_META.disconnectGraceMs)).toEqual([]);
  });
});

describe('host 权限与转移', () => {
  it('非 host 踢人 / 改设置 / 转 host 一律被拒', () => {
    const r = roomWith(2);
    expect(r.kickPlayer('p0', 'p1', T0)).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(r.updateSettings('p0', { maxPlayers: 4 }, T0)).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(r.transferHost('p0', 'p1', T0)).toEqual({ ok: false, error: 'NOT_HOST' });
  });

  it('host 不能踢自己', () => {
    const r = roomWith(1);
    expect(r.kickPlayer('host', 'host', T0)).toEqual({ ok: false, error: 'CANNOT_TARGET_SELF' });
  });

  it('开局后不能踢人', () => {
    const r = roomWith(1);
    r.claimOracle('p0', T0);
    r.setReady('host', true, T0);
    r.setReady('p0', true, T0);
    r.startGame('host', T0);
    expect(r.kickPlayer('host', 'p0', T0)).toEqual({ ok: false, error: 'NOT_LOBBY_PHASE' });
  });

  it('host 离开 → host 交给剩下的人', () => {
    const r = roomWith(1);
    r.removePlayer('host', T0);
    expect(r.hostId).toBe('p0');
    expect(r.player('p0')!.isHost).toBe(true);
  });

  it('**bot 永不继承 host**', () => {
    const r = roomWith(2);
    r.player('p0')!.isBot = true;
    r.removePlayer('host', T0);
    expect(r.hostId).toBe('p1'); // 跳过 bot
  });

  it('hasHumanPlayers:只剩 bot 或空房都是 false', () => {
    const r = roomWith(1);
    expect(r.hasHumanPlayers()).toBe(true);
    r.player('host')!.isBot = true;
    r.player('p0')!.isBot = true;
    expect(r.hasHumanPlayers()).toBe(false);
  });

  it('满员拒绝加入', () => {
    const r = room();
    r.updateSettings('host', { maxPlayers: 2 }, T0);
    expect(r.addPlayer('p0', 'a', T0).ok).toBe(true);
    expect(r.addPlayer('p1', 'b', T0)).toEqual({ ok: false, error: 'ROOM_FULL' });
  });
});

describe('settings:仅 lobby phase 可改,且值受 config 表 / meta 钳制', () => {
  it('非 lobby phase 一律拒改', () => {
    const r = roomWith(1);
    r.claimOracle('p0', T0);
    r.setReady('host', true, T0);
    r.setReady('p0', true, T0);
    r.startGame('host', T0);
    expect(r.updateSettings('host', { maxPlayers: 6 }, T0)).toEqual({
      ok: false,
      error: 'NOT_LOBBY_PHASE',
    });
  });

  it('**换 puzzleType → budget 回落到 config 表的默认值**(差异只经由表)', () => {
    const r = room();
    r.updateSettings('host', { puzzleType: 'twenty_questions' }, T0);
    expect(r.settings.budget).toBe(20); // 表里的 defaultBudget

    r.updateSettings('host', { puzzleType: 'situation' }, T0);
    expect(r.settings.budget).toBeNull(); // 海龟汤无额度
  });

  it('给无额度的类型设 budget 会被钉死成 null,而不是偷偷生效', () => {
    const r = room(); // situation
    r.updateSettings('host', { budget: 30 }, T0);
    expect(r.settings.budget).toBeNull();
  });

  it('pendingCap 钳在 meta 的 1–3', () => {
    const r = room();
    r.updateSettings('host', { pendingCap: 99 }, T0);
    expect(r.settings.pendingCap).toBe(GAME_META.pendingCapMax);
    r.updateSettings('host', { pendingCap: 0 }, T0);
    expect(r.settings.pendingCap).toBe(GAME_META.pendingCapMin);
  });

  it('maxPlayers 不许压到当前人数以下', () => {
    const r = roomWith(3); // 4 人
    expect(r.updateSettings('host', { maxPlayers: 2 }, T0)).toEqual({
      ok: false,
      error: 'INVALID_SETTINGS',
    });
  });

  it('非法 puzzleType 被拒', () => {
    const r = room();
    expect(
      r.updateSettings('host', { puzzleType: 'who_am_i' as never }, T0),
    ).toEqual({ ok: false, error: 'INVALID_SETTINGS' });
  });
});
