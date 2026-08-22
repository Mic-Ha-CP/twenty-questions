/**
 * RoomManager —— 通用面 #2 / #4 / #5 / #7。
 *
 * 重点是那条「从外面观察不到的退出路径」:idle sweep。
 * 少了 onRoomRemoved,per-room 资源(将来的题库 Set、计时器)会真的泄漏。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_META } from '@shared/meta';
import { RoomManager, type RemovalReason } from './RoomManager';

const HOST = { id: 'host', nickname: '沉默的侦探' };

/** 可控时钟 —— 不靠真实时间测宽限和闲置。 */
function mgr(startAt = 1_000_000) {
  let now = startAt;
  const m = new RoomManager(() => now);
  return {
    m,
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

function mustCreate(m: RoomManager, isPrivate = false) {
  const r = m.create(HOST, isPrivate);
  if (!r.ok) throw new Error(`create failed: ${r.error}`);
  return r.value;
}

describe('双轨寻址(通用面 #7)', () => {
  it('公开房拿号,私密房**永不**拿号', () => {
    const { m } = mgr();
    expect(mustCreate(m, false).displayNumber).toBe(1);
    expect(mustCreate(m, true).displayNumber).toBeNull();
    expect(mustCreate(m, false).displayNumber).toBe(2);
  });

  it('房间关闭后号被回收,发给下一个最小未用', () => {
    const { m } = mgr();
    const a = mustCreate(m, false); // #1
    const b = mustCreate(m, false); // #2
    expect(b.displayNumber).toBe(2);

    m.remove(a.code, 'empty'); // 释放 #1
    expect(mustCreate(m, false).displayNumber).toBe(1);
  });

  it('转私密立刻收回号;转回公开重新发号', () => {
    const { m, at } = mgr();
    const r = mustCreate(m, false);
    expect(r.displayNumber).toBe(1);

    r.updateSettings('host', { isPrivate: true }, at());
    m.syncPrivacy(r);
    expect(r.displayNumber).toBeNull(); // ← 不许留着号

    r.updateSettings('host', { isPrivate: false }, at());
    m.syncPrivacy(r);
    expect(r.displayNumber).toBe(1);
  });

  it('房间码是 4 位数字且互不重复', () => {
    const { m } = mgr();
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) codes.add(mustCreate(m).code);
    expect(codes.size).toBe(50);
    for (const c of codes) expect(c).toMatch(/^\d{4}$/);
  });

  it('byCode 忽略大小写和首尾空白', () => {
    const { m } = mgr();
    const r = mustCreate(m);
    expect(m.byCode(`  ${r.code} `)?.code).toBe(r.code);
  });
});

describe('MAX_ROOMS 上限', () => {
  it('到顶之后建房被拒,而不是无声地跑飞', () => {
    const { m } = mgr();
    for (let i = 0; i < GAME_META.maxRooms; i++) mustCreate(m);
    expect(m.size()).toBe(GAME_META.maxRooms);
    expect(m.create(HOST, false)).toEqual({ ok: false, error: 'ROOM_LIMIT_REACHED' });
  });
});

describe('onRoomRemoved 覆盖每一条退出路径(通用面 #2)', () => {
  it('显式 remove 会触发回调,并带上原因', () => {
    const { m } = mgr();
    const seen: RemovalReason[] = [];
    m.onRoomRemoved((_r, reason) => seen.push(reason));

    const r = mustCreate(m);
    m.remove(r.code, 'empty');
    expect(seen).toEqual(['empty']);
  });

  it('空房被拆 → empty', () => {
    const { m, at } = mgr();
    const seen: RemovalReason[] = [];
    m.onRoomRemoved((_r, reason) => seen.push(reason));

    const r = mustCreate(m);
    r.removePlayer('host', at());
    expect(m.removeIfDeserted(r)).toBe(true);
    expect(seen).toEqual(['empty']);
  });

  it('**只剩 bot 的房间也要被拆** → no_humans(通用面 #4)', () => {
    const { m } = mgr();
    const seen: RemovalReason[] = [];
    m.onRoomRemoved((_r, reason) => seen.push(reason));

    const r = mustCreate(m);
    r.player('host')!.isBot = true;
    expect(m.removeIfDeserted(r)).toBe(true);
    expect(seen).toEqual(['no_humans']);
  });

  it('还有真人就不拆', () => {
    const { m } = mgr();
    const r = mustCreate(m);
    expect(m.removeIfDeserted(r)).toBe(false);
    expect(m.size()).toBe(1);
  });

  it('remove 一个不存在的 code 不会触发回调', () => {
    const { m } = mgr();
    let calls = 0;
    m.onRoomRemoved(() => calls++);
    m.remove('9999', 'idle');
    expect(calls).toBe(0);
  });
});

describe('idle sweep —— 唯一从外面观察不到的退出路径', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('闲置超时的房被清掉,且**走 onRoomRemoved**(否则 lobby 列表不会更新)', () => {
    const { m, advance } = mgr();
    const seen: RemovalReason[] = [];
    m.onRoomRemoved((_r, reason) => seen.push(reason));

    mustCreate(m);
    m.startSweep();

    advance(GAME_META.idleSweepAfterMs + 1);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);

    expect(m.size()).toBe(0);
    expect(seen).toEqual(['idle']);
    m.stopSweep();
  });

  it('没到闲置阈值就不动它', () => {
    const { m, advance } = mgr();
    mustCreate(m);
    m.startSweep();

    advance(GAME_META.idleSweepAfterMs - 1000);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);

    expect(m.size()).toBe(1);
    m.stopSweep();
  });

  it('超过宽限仍未回来的断线玩家会被扫走,并回调 onRoomChanged', () => {
    const { m, advance, at } = mgr();
    const r = mustCreate(m);
    r.addPlayer('p0', '多疑的证人', at());
    r.markDisconnected('p0', at());

    const changed: string[] = [];
    m.startSweep((room) => changed.push(room.code));

    advance(GAME_META.disconnectGraceMs + 1);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);

    expect(r.players.map((p) => p.id)).toEqual(['host']);
    expect(changed).toEqual([r.code]);
    m.stopSweep();
  });

  it('全员断线超时 → 房间空了 → 被拆,原因是 empty 不是 idle', () => {
    const { m, advance, at } = mgr();
    const seen: RemovalReason[] = [];
    m.onRoomRemoved((_r, reason) => seen.push(reason));

    const r = mustCreate(m);
    r.markDisconnected('host', at());
    m.startSweep();

    advance(GAME_META.disconnectGraceMs + 1);
    vi.advanceTimersByTime(GAME_META.idleSweepIntervalMs);

    expect(m.size()).toBe(0);
    expect(seen).toEqual(['empty']);
    m.stopSweep();
  });

  it('重复 startSweep 不会叠加计时器', () => {
    const { m } = mgr();
    m.startSweep();
    m.startSweep();
    expect(vi.getTimerCount()).toBe(1);
    m.stopSweep();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('lookup', () => {
  it('byPlayer 找得到人所在的房', () => {
    const { m, at } = mgr();
    const r = mustCreate(m);
    r.addPlayer('p0', '多疑的证人', at());
    expect(m.byPlayer('p0')?.code).toBe(r.code);
    expect(m.byPlayer('查无此人')).toBeUndefined();
  });

  it('allRooms 只做枚举,过滤是调用方的事(通用面 #5)', () => {
    const { m } = mgr();
    mustCreate(m, false);
    mustCreate(m, true);
    expect(m.allRooms()).toHaveLength(2); // ← 私密房也在里面,manager 不替你过滤
  });
});
