/**
 * 认领回执与本地房间状态的对账。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 幽灵房间(本地 smoke 实测发现)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * server 重启后 client 会自动重连,`c:hello` 也会成功 —— 但它记着的那个房间
 * 已经随进程一起蒸发了(ADR-12:live 状态全内存,零持久化)。
 *
 * 旧行为:client 留在房间屏上,每点一下收一条 `NOT_IN_ROOM`,
 * 而那条提示 3 秒后自己消失。用户看到的是**一个永远不动的界面**。
 *
 * 修法:`s:hello_ok` 现在带上 `roomCode`(或 `null`),client 拿它和本地记的对一次账。
 * 这个函数就是那次对账 —— **纯函数,不碰 store,可单测**。
 *
 * 三种结果:
 *   · 对得上           → 什么都不做;
 *   · 本地有、server 说没有 → **退回 landing 并明说「房间已不存在」**;
 *   · 本地有 A、server 说是 B → 也退回(这种情况理论上不该发生,但宁可退也别错屏)。
 */

export interface PresenceInput {
  /** client 本地记着的房间码;没在房里就是 null。 */
  localCode: string | null;
  /** `s:hello_ok` 说的房间码;哪儿都不在就是 null。 */
  serverCode: string | null;
}

export interface PresenceDecision {
  /** 要不要把本地的 room 清掉(= 退回 landing)。 */
  clearRoom: boolean;
  /**
   * 要不要给用户一句解释。**只有「本地以为在、其实不在」才需要** ——
   * 本来就没在房里的人不需要被告知任何事。
   */
  notice: 'ROOM_GONE' | null;
}

export function reconcilePresence({ localCode, serverCode }: PresenceInput): PresenceDecision {
  // 本来就没在房里 —— 无事发生。
  if (localCode === null) return { clearRoom: false, notice: null };

  // 对得上,继续玩。
  if (localCode === serverCode) return { clearRoom: false, notice: null };

  // 本地以为在某个房间,server 说不在(或说在别的房间)→ 退回并解释。
  return { clearRoom: true, notice: 'ROOM_GONE' };
}
