/**
 * LobbyBroadcaster — 通用面 #8,照 LOBBY-PATTERN.md 的四条规则重建。
 *
 * build / emit 由外部注入 —— 这就是它**不需要 socket 也能单测**的原因。
 * 本文件对本游戏一无所知,可原样搬去下一个游戏。
 *
 * 四条规则:
 *  1. 只发 summary,永不发房间状态(whitelist 在 Room.toSummary)。
 *  2. Coalesce:schedule() 起一个窗口,窗口内的后续调用搭同一班车。
 *  3. **Dedupe —— 比 debounce 更要紧。** mutation hook 是**每一次** mutation 的
 *     choke point,包含每一局游戏里的每一步,而那些都不改变列表行。flush 时把
 *     序列化结果和上次发出的比一比,一样就闭嘴 —— 闲着的 lobby 客户端不该被
 *     它们根本看不见的流量吵醒。
 *  4. 新订阅者绕过前两条:current() 不合并、不去重,刚订阅的 socket 什么都没见过。
 *
 * 列表**必须排序**:没排序的话规则 3 不可靠 —— 迭代顺序的变化会被读成内容变化。
 */

export interface LobbyBroadcasterOptions {
  /** 合并窗口(ms)。 */
  windowMs?: number;
}

export class LobbyBroadcaster<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSerialized: string | null = null;
  private readonly windowMs: number;

  constructor(
    private readonly build: () => T[],
    private readonly emit: (rooms: T[]) => void,
    opts: LobbyBroadcasterOptions = {},
  ) {
    this.windowMs = opts.windowMs ?? 50;
  }

  /** 规则 2:起一个窗口;窗口内重复调用搭同一班车。 */
  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.windowMs);
    // 别让一个待发的 lobby 广播吊住进程退出。
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** 规则 3:内容没变就不发。 */
  private flush(): void {
    const rooms = this.build();
    const serialized = JSON.stringify(rooms);
    if (serialized === this.lastSerialized) return;
    this.lastSerialized = serialized;
    this.emit(rooms);
  }

  /**
   * 规则 4:给刚订阅的人用。不合并、不去重、**不**更新 lastSerialized ——
   * 它是点对点的快照,不是一次广播。
   */
  current(): T[] {
    return this.build();
  }

  /** 测试用:立刻结算待发窗口。 */
  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
