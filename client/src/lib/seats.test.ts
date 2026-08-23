/**
 * 座位色 + 真相面板渲染判定。
 *
 * 「接管后新 oracle 的投影含 truth 且 **UI 有渲染点**」这条验收里的后半句就落在
 * `shouldShowTruthPanel` 上 —— 投影侧由 server 的 handoff.test.ts 钉住,
 * 渲染侧由这里钉住。
 */

import { describe, expect, it } from 'vitest';
import { seatBadge, seatColor, shouldShowTruthPanel } from './seats';

describe('座位色:确定性与唯一性', () => {
  it('同一个号永远同一个色 —— 每个 client 算出来都一样', () => {
    expect(seatColor(3)).toBe(seatColor(3));
  });

  it('前 8 个号两两不同色', () => {
    const colors = [1, 2, 3, 4, 5, 6, 7, 8].map(seatColor);
    expect(new Set(colors).size).toBe(8);
  });

  it('第 9 个人换一档明度,不和 1 号撞色', () => {
    expect(seatColor(9)).not.toBe(seatColor(1));
  });

  it('**禁琥珀**:座位色不许落在 accent 的色相附近(hue 74)', () => {
    for (let n = 1; n <= 16; n++) {
      const hue = Number(/oklch\([\d.]+ [\d.]+ (\d+)\)/.exec(seatColor(n))![1]);
      expect(Math.abs(hue - 74)).toBeGreaterThan(20);
    }
  });

  it('**避开判定色**:不落在判定绿(150)与判定红(25)附近', () => {
    for (let n = 1; n <= 16; n++) {
      const hue = Number(/oklch\([\d.]+ [\d.]+ (\d+)\)/.exec(seatColor(n))![1]);
      expect(Math.abs(hue - 150)).toBeGreaterThan(20);
      expect(Math.abs(hue - 25)).toBeGreaterThan(20);
      expect(Math.abs(hue - 385)).toBeGreaterThan(20); // 25 的绕圈等价
    }
  });

  it('彩度压得住 —— 是墨点不是霓虹', () => {
    const chroma = Number(/oklch\([\d.]+ ([\d.]+) /.exec(seatColor(1))![1]);
    expect(chroma).toBeLessThanOrEqual(0.1);
  });

  it('越界输入不崩', () => {
    expect(seatColor(0)).toMatch(/^oklch\(/);
    expect(seatColor(-5)).toMatch(/^oklch\(/);
  });
});

describe('座位徽章', () => {
  it('1–20 用圈号', () => {
    expect(seatBadge(1)).toBe('①');
    expect(seatBadge(3)).toBe('③');
    expect(seatBadge(20)).toBe('⑳');
  });

  it('超出范围退回普通数字,不留空', () => {
    expect(seatBadge(21)).toBe('#21');
    expect(seatBadge(0)).toBe('#0');
  });
});

describe('真相面板:只在 oracle 那一侧渲染', () => {
  it('oracle 且有真相 → 渲染', () => {
    expect(
      shouldShowTruthPanel({ oracleId: 'o', viewerId: 'o', oracleTruth: 'SECRET' }),
    ).toBe(true);
  });

  it('**guesser 拿不到值,也就渲染不出来** —— 结构性缺席自动兜底', () => {
    expect(
      shouldShowTruthPanel({ oracleId: 'o', viewerId: 'g', oracleTruth: null }),
    ).toBe(false);
  });

  it('还没录题 → 不渲染', () => {
    expect(shouldShowTruthPanel({ oracleId: 'o', viewerId: 'o', oracleTruth: null })).toBe(false);
  });

  it('座位空着 → 不渲染', () => {
    expect(
      shouldShowTruthPanel({ oracleId: null, viewerId: 'g', oracleTruth: null }),
    ).toBe(false);
  });

  it('**接管之后新 oracle 立刻有渲染点,前任立刻没有**(SPEC §7)', () => {
    const before = { oracleId: 'old', viewerId: 'new', oracleTruth: null };
    expect(shouldShowTruthPanel(before)).toBe(false);

    // 接管发生:server 的投影把 truth 换到新 oracle 那一份上
    const afterNew = { oracleId: 'new', viewerId: 'new', oracleTruth: 'SECRET' };
    const afterOld = { oracleId: 'new', viewerId: 'old', oracleTruth: null };
    expect(shouldShowTruthPanel(afterNew)).toBe(true);
    expect(shouldShowTruthPanel(afterOld)).toBe(false);
  });
});
