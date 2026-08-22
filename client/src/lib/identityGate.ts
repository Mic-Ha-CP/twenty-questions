/**
 * IdentityGate —— 身份认领闸门。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 它解决的竞态(NOTES 待决 #7,session 2 浏览器实测发现)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `socket.io-client` 在**断线期间**会把 `emit` 缓冲起来,重连时冲出去。
 * 冲的时机在它的 `onconnect` 里:
 *
 *     onconnect(id, pid) {
 *       this.connected = true;
 *       this.emitBuffered();            // ← 先冲缓冲区
 *       this.emitReserved('connect');   // ← 再叫用户的 'connect' 监听器
 *     }
 *
 * 而我们的 `c:hello`(认领稳定 playerId)恰恰是在 `'connect'` 监听器里发的。
 * 于是顺序变成:
 *
 *     c:create_room   ← 断线期间点的,被缓冲,先到
 *     c:hello         ← 后到
 *
 * server 收到 `c:create_room` 时还不认得这个 socket,回 `INVALID_PAYLOAD`。
 * 用户看到的是「点了没反应」—— 错误提示几秒后自己消失,谁也没读到。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 修法
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **不让业务事件进 socket.io 的缓冲区。** 未认领时事件排在 gate 自己的队列里,
 * 收到 `s:hello_ok` 才按 FIFO 冲出去。`c:hello` 由 gate 在 connect 时直发,
 * 绕过队列 —— 它必然是这条连接上的第一个业务包。
 *
 * 三条不变量:
 *   1. **认领事件永远第一个上线。**
 *   2. **未认领时,任何业务事件都不上线。**
 *   3. **不静默丢。** 排队;队列真的满了要**报出来**,不许悄悄扔。
 *
 * 另外把状态暴露给 UI(`onStateChange`),让按钮能禁用 —— 排队之外还要有可见反馈。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 给别的 repo:这段是可移植的
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 本文件不 import socket.io,只依赖注入的 `transport` 与 `identify`。
 * 任何「先握手、后干活」的 socket 客户端都是同一个形状,照抄即可;
 * 回归测试见 `identityGate.test.ts`,里面**同时保留了修复前的实现**并断言它确实会翻车,
 * 所以那份测试本身就是这条 bug 的可执行规格。
 */

export type GateState =
  /** 没连上。 */
  | 'offline'
  /** 连上了,认领事件已发出,还没收到确认。**业务事件在这里排队。** */
  | 'identifying'
  /** 已认领。业务事件直发。 */
  | 'ready';

export interface GateTransport {
  emit(event: string, payload: unknown): void;
}

export interface QueuedEvent {
  event: string;
  payload: unknown;
}

export interface IdentityGateOptions {
  transport: GateTransport;
  /** 连上时要发的认领事件。每次(重)连都重发 —— 稳定 playerId 重绑新 socket(SPEC §7)。 */
  identify: () => QueuedEvent;
  /**
   * 队列上限。正常玩根本碰不到(人手点不了那么快);
   * 设它只是为了让「无限堆积」这种坏掉的状态有个边界。
   */
  maxQueue?: number;
  onStateChange?: (state: GateState) => void;
  /** 队列满时调用。**存在的意义就是「不静默丢」** —— 调用方必须让用户看见。 */
  onOverflow?: (dropped: QueuedEvent) => void;
}

const DEFAULT_MAX_QUEUE = 32;

export class IdentityGate {
  private _state: GateState = 'offline';
  private queue: QueuedEvent[] = [];
  private readonly maxQueue: number;

  constructor(private readonly opts: IdentityGateOptions) {
    this.maxQueue = opts.maxQueue ?? DEFAULT_MAX_QUEUE;
  }

  get state(): GateState {
    return this._state;
  }

  /** 还压着几条。UI 可以拿它显示「排队中」。 */
  get queuedCount(): number {
    return this.queue.length;
  }

  get isReady(): boolean {
    return this._state === 'ready';
  }

  /**
   * 业务事件的**唯一**出口。别绕过它直接 `socket.emit` ——
   * 绕过去就等于把这条 bug 放回来。
   */
  send(event: string, payload: unknown = {}): void {
    if (this._state === 'ready') {
      this.opts.transport.emit(event, payload);
      return;
    }
    if (this.queue.length >= this.maxQueue) {
      // 不静默丢:报给调用方,由它决定怎么让用户看见。
      this.opts.onOverflow?.({ event, payload });
      return;
    }
    this.queue.push({ event, payload });
  }

  /**
   * socket `'connect'` 时调。
   * **认领事件在这里直发**,绕过队列 —— 保证它是这条连接上的第一个业务包。
   */
  handleConnect(): void {
    this.setState('identifying');
    const hello = this.opts.identify();
    this.opts.transport.emit(hello.event, hello.payload);
  }

  /** 收到 `s:hello_ok` 时调。按 FIFO 把攒下的冲出去。 */
  handleIdentified(): void {
    this.setState('ready');
    // 先取出再发:发的过程中如果又有 send 进来,它会走 ready 分支直发,
    // 顺序仍然对(队列里的都比它早)。
    const pending = this.queue;
    this.queue = [];
    for (const item of pending) {
      this.opts.transport.emit(item.event, item.payload);
    }
  }

  /** socket `'disconnect'` 时调。闸门重新关上,之后的 send 继续排队而不是被缓冲进 socket.io。 */
  handleDisconnect(): void {
    this.setState('offline');
  }

  /** 丢弃排队中的事件(离开房间之类的场景),显式调用,不会自己发生。 */
  discardQueued(): QueuedEvent[] {
    const dropped = this.queue;
    this.queue = [];
    return dropped;
  }

  private setState(next: GateState): void {
    if (this._state === next) return;
    this._state = next;
    this.opts.onStateChange?.(next);
  }
}
