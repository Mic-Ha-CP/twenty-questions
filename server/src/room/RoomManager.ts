/**
 * RoomManager — 通用面 #2 / #5 / #7 的所有者。
 *
 * 拥有:房间码与 displayNumber 的分配与回收、MAX_ROOMS 上限、闲置扫描、
 * 房间移除回调。**过滤和投影故意是调用方的活** —— manager 不知道 lobby 行长什么样。
 */

import { err, ok, type Result } from '@shared/events';
import { GAME_META } from '@shared/meta';
import type { PlayerId, RoomCode } from '@shared/types';
import { Room } from './Room';

type RoomRemovedHandler = (room: Room, reason: RemovalReason) => void;
export type RemovalReason = 'empty' | 'idle' | 'no_humans';

export class RoomManager {
  private rooms = new Map<RoomCode, Room>();
  /** 已发出的公开房号;私密房永远不在这里面。 */
  private usedNumbers = new Set<number>();
  private removedHandlers: RoomRemovedHandler[] = [];
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /* ───────────────────────── create / lookup ───────────────────────── */

  /**
   * ⚠️ create-then-modify 竞态(LOBBY-PATTERN「Gotcha worth inheriting」):
   * 任何「先建房、再对它做点什么」的流程**必须以私密建房**,否则那一个来回里
   * 房间是公开且有空位的,lobby 里的人可能坐进一个还没配置好的房间。
   *
   * 本游戏的建房是单步的,但**建房时就带上 isPrivate**,而不是先建公开房再改设置 ——
   * 这样这条路径从一开始就没有那个窗口。
   */
  create(host: { id: PlayerId; nickname: string }, isPrivate: boolean): Result<Room> {
    if (this.rooms.size >= GAME_META.maxRooms) return err('ROOM_LIMIT_REACHED');
    const code = this.allocateCode();
    if (code === null) return err('ROOM_LIMIT_REACHED');

    const room = new Room({
      code,
      // 私密房**永不**拿号 —— 顺序号会让未列出的房间可被枚举(通用面 #7)。
      displayNumber: isPrivate ? null : this.allocateNumber(),
      host,
      isPrivate,
      now: this.now(),
    });
    this.rooms.set(code, room);
    return ok(room);
  }

  byCode(code: RoomCode): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  byPlayer(playerId: PlayerId): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.has(playerId)) return room;
    }
    return undefined;
  }

  /** 通用面 #5:只做枚举。过滤/投影是调用方的事。 */
  allRooms(): Room[] {
    return [...this.rooms.values()];
  }

  size(): number {
    return this.rooms.size;
  }

  /* ─────────────────── privacy → number bookkeeping ─────────────────── */

  /** 设置改动后调用:公私切换时同步发号 / 收号。 */
  syncPrivacy(room: Room): void {
    room.applyPrivacy(
      () => this.allocateNumber(),
      (n) => this.usedNumbers.delete(n),
    );
  }

  /* ────────────────────────── removal ─────────────────────────── */

  /**
   * 通用面 #2:**每一条**退出路径都要经过这里,闲置扫描也不例外。
   * 少了这个回调,per-room 资源(将来的计时器、题库 Set)会真的泄漏。
   */
  onRoomRemoved(cb: RoomRemovedHandler): void {
    this.removedHandlers.push(cb);
  }

  remove(code: RoomCode, reason: RemovalReason): void {
    const room = this.rooms.get(code);
    if (!room) return;
    this.rooms.delete(code);
    if (room.displayNumber !== null) this.usedNumbers.delete(room.displayNumber);
    for (const cb of this.removedHandlers) cb(room, reason);
  }

  /** 房间空了 / 只剩 bot 就拆掉。返回是否真的拆了。 */
  removeIfDeserted(room: Room): boolean {
    if (room.players.length === 0) {
      this.remove(room.code, 'empty');
      return true;
    }
    // 通用面 #4:只剩 bot 的房间没有意义,且 bot 不能继承 host。
    if (!room.hasHumanPlayers()) {
      this.remove(room.code, 'no_humans');
      return true;
    }
    return false;
  }

  /* ────────────────────────── idle sweep ─────────────────────────── */

  /**
   * 闲置扫描。也顺手清掉**超过宽限仍未回来**的断线玩家 ——
   * 宽限重连(SPEC §7)的另一半就在这里。
   * 扫描造成的每一次移除都会走 onRoomRemoved,所以 lobby 列表会自己更新。
   */
  startSweep(onRoomChanged?: (room: Room) => void): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = this.now();
      for (const room of [...this.rooms.values()]) {
        let changed = false;

        for (const id of room.expiredDisconnects(now)) {
          room.removePlayer(id, now);
          changed = true;
        }
        if (this.removeIfDeserted(room)) continue;

        if (now - room.lastActivityAt > GAME_META.idleSweepAfterMs) {
          this.remove(room.code, 'idle');
          continue;
        }
        if (changed) onRoomChanged?.(room);
      }
    }, GAME_META.idleSweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  stopSweep(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /* ────────────────────────── allocation ─────────────────────────── */

  /**
   * 4 位数字房间码 —— 朋友要在 Discord 语音里**念出来**,这是可读性优先的选择。
   * 偏差记录见 NOTES:4 位 = 1 万空间,私密房的「不可枚举」比登记的模式弱,
   * 但比顺序号强得多(顺序号是 100% 命中)。威胁模型是朋友,不是攻击者。
   */
  private allocateCode(): RoomCode | null {
    for (let i = 0; i < 500; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  /** 最小未用号,房间关闭后回收复用(通用面 #7)。 */
  private allocateNumber(): number {
    let n = 1;
    while (this.usedNumbers.has(n)) n++;
    this.usedNumbers.add(n);
    return n;
  }
}
