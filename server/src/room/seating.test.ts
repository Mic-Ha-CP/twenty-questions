/**
 * 玩家序号(`seatNo`)—— 身份三件套里「稳定序号」那一件。
 *
 * 为什么需要它:访客名是随机生成的,一屋子人里出现「早到的钟表匠」和
 * 「早到的收音机」是常事,Q&A 流里光看名字容易认错人。序号 + 固定颜色点
 * 给每个人一个**跨屏一致**的锚。
 *
 * 关键约束:**不回收**。3 号走了,下一个进来的是 4 号 —— 复用会让
 * 「刚才 3 号说的那句」在同一晚里指向两个人,而那正是序号要解决的问题。
 */

import { describe, expect, it } from 'vitest';
import { Room } from './Room';

const T0 = 1_000_000;

function room() {
  return new Room({
    code: '1234',
    displayNumber: 1,
    host: { id: 'host', nickname: 'H' },
    isPrivate: false,
    now: T0,
  });
}

describe('seatNo 分配', () => {
  it('房主是 1 号', () => {
    expect(room().player('host')!.seatNo).toBe(1);
  });

  it('按入房顺序递增', () => {
    const r = room();
    r.addPlayer('a', 'A', T0);
    r.addPlayer('b', 'B', T0);
    expect(r.player('a')!.seatNo).toBe(2);
    expect(r.player('b')!.seatNo).toBe(3);
  });

  it('**不回收** —— 走了一个,下一个拿新号,不补空位', () => {
    const r = room();
    r.addPlayer('a', 'A', T0);
    r.addPlayer('b', 'B', T0);
    r.removePlayer('a', T0); // 2 号走了

    r.addPlayer('c', 'C', T0);
    expect(r.player('c')!.seatNo).toBe(4); // ← 不是 2
    expect(r.player('b')!.seatNo).toBe(3); // 别人的号不动
  });

  it('重连不换号 —— 稳定 playerId 拿回同一个号', () => {
    const r = room();
    r.addPlayer('a', 'A', T0);
    const before = r.player('a')!.seatNo;

    r.markDisconnected('a', T0);
    r.addPlayer('a', 'A', T0 + 5000);
    expect(r.player('a')!.seatNo).toBe(before);
  });

  it('改名不换号 —— 号是身份锚,名字才是会变的那个', () => {
    const r = room();
    r.addPlayer('a', 'A', T0);
    const before = r.player('a')!.seatNo;
    r.setNickname('a', '换了个名字', T0);
    expect(r.player('a')!.seatNo).toBe(before);
  });

  it('号在一房之内唯一', () => {
    const r = room();
    for (let i = 0; i < 6; i++) r.addPlayer(`p${i}`, `P${i}`, T0);
    const nos = r.players.map((p) => p.seatNo);
    expect(new Set(nos).size).toBe(nos.length);
  });

  it('跨局保留 —— 归位不动它', () => {
    const r = room();
    r.addPlayer('a', 'A', T0);
    const before = r.player('a')!.seatNo;
    r.resetForNextRound(T0);
    expect(r.player('a')!.seatNo).toBe(before);
  });

  it('seatNo 进 client 投影(UI 要拿它渲染徽章和颜色)', () => {
    const r = room();
    r.addPlayer('a', 'A', T0);
    const st = r.toClientState('a');
    expect(st.players.every((p) => typeof p.seatNo === 'number')).toBe(true);
  });

  it('**不进 lobby 行** —— toSummary 仍是 8 个字段', () => {
    const r = room();
    r.addPlayer('a', 'A', T0);
    expect(Object.keys(r.toSummary())).toHaveLength(8);
  });
});
