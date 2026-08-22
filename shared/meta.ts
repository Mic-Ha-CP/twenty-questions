/**
 * 通用面 #9:**per-game metadata 是 load-bearing API,不是文档。**
 *
 * `maxPlayers` 在**运行时被读取**(房间准入、settings 钳制),不是某处的硬编码常量。
 * 改这里的形状会弄坏 room admission,不只是弄坏一个列表 —— 这正是登记它的理由。
 */
export const GAME_META = {
  /** 稳定字符串,将来是分区键(CONVENTIONS.md)。 */
  gameId: 'twenty-questions',

  /** co-op 下限:1 oracle + ≥1 guesser(SPEC §3 start gate)。 */
  minPlayers: 2,
  /** 房间容量默认值;host 可在 lobby 调,钳在 [minPlayers, maxPlayersLimit]。 */
  defaultMaxPlayers: 8,
  maxPlayersLimit: 12,

  /** per-player 未判问题上限的可调范围(SPEC §4)。 */
  pendingCapDefault: 1,
  pendingCapMin: 1,
  pendingCapMax: 3,

  /** 断线宽限(ms)。超过这个时间 oracle 仍未回来,host 可转移出题人(SPEC §7)。 */
  disconnectGraceMs: 60_000,
  /** 空房闲置清理阈值(ms)。 */
  idleSweepAfterMs: 30 * 60_000,
  idleSweepIntervalMs: 60_000,

  /** RoomManager 上限,防跑飞。 */
  maxRooms: 200,
} as const;

export type GameMeta = typeof GAME_META;
