/**
 * Phase 机(SPEC §3)—— **scaffold 阶段只有骨架,中段是空壳。**
 *
 *   lobby → setup → playing → reveal ─┬→ setup   (再来一局,默认换 oracle)
 *                                      └→ lobby   (改设置)
 *
 * ⚠️ 与 PLATFORM.md 的登记有意偏差:通用层写「every game has a phase field with at
 * least a `lobby` and an `ended` state」。**本游戏没有 ended** —— 房间跨局不散,
 * `reveal` 是一局的终点,不是房间的终点。房间的终点是 RoomManager 把它清掉。
 * 记在 NOTES 偏差 log,rule-of-three 要的就是这种不一致。
 *
 * 本 session 只实现 lobby → setup 一条边(start gate 在 Room.startGame)。
 * 其余转移是**声明好的空壳**:表在这里,守卫在这里,动作还没有。
 */

import type { Phase } from '@shared/types';

/** 合法转移表。**加边只能改这张表**,不许在 handler 里就地判 phase。 */
const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  lobby: ['setup'],
  setup: ['playing', 'lobby'],
  playing: ['reveal'],
  reveal: ['setup', 'lobby'],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextPhases(from: Phase): readonly Phase[] {
  return TRANSITIONS[from];
}

/* ───────────────────────── 空壳路由 ─────────────────────────
 *
 * 下面三个是**下一个 session 的施工面**,现在只有签名和归属说明。
 * 故意不写 TODO 以外的任何逻辑 —— 本 session 明确不做判定循环 / 队列 / 额度 / 题库。
 *
 *   setup    录题(SPEC §6):题库选题 + 防剧透三件套 + per-room 已用 Set;
 *            20Q 锁定答案词。海龟汤确认选题即公开汤面,oracle 点「开汤」→ playing。
 *
 *   playing  判定循环(SPEC §5):FIFO 队列 + pending cap + 入队即扣额度 +
 *            判定改错 + 海龟汤还原提交通道。
 *
 *   reveal   公开真相 + 结果 + 出题人交接(SPEC §3):默认猜中者接棒,
 *            未猜中则 oracle 连任,host 可改。
 *
 * 三者的类型差异**只能**经由 shared/puzzleTypes.ts 的 config 表,
 * 不许出现 `if (puzzleType === ...)`。
 * ───────────────────────────────────────────────────────── */
