/**
 * 重连竞态的回归测试(NOTES 待决 #7)。
 *
 * 这份文件是那条 bug 的**可执行规格**,不只是「测一下 gate」:
 *  · `FakeSocketIO` 复刻 socket.io-client 的缓冲与顺序语义;
 *  · `describe('修复前的实现')` **保留了旧写法并断言它确实翻车** ——
 *    所以「红」是永久可复现的,不需要 git revert 才能看见;
 *  · `describe('修复后')` 断言 gate 把顺序纠正过来。
 *
 * **别的 repo 照着修的话,照抄这份契约即可** —— 它不依赖本游戏的任何东西。
 *
 * CI 稳定性:全同步,无计时器、无真 socket、无随机。
 */

import { describe, expect, it, vi } from 'vitest';
import { IdentityGate, type GateState, type QueuedEvent } from './identityGate';

/* ═══════════════════════════════════════════════════════════════════════════
 * socket.io-client 的语义复刻
 *
 * 关键在 connect() 里的两行顺序 —— 那就是竞态的全部机理:
 *     emitBuffered()            先冲断线期间攒下的
 *     emitReserved('connect')   再叫用户的 'connect' 监听器
 * 我们的 c:hello 是在后者里发的,所以它排在缓冲包**后面**。
 * ═══════════════════════════════════════════════════════════════════════════ */
class FakeSocketIO {
  connected = false;
  /** 真正「上线」的事件序 —— 断言看的就是它。 */
  readonly wire: string[] = [];
  private buffer: QueuedEvent[] = [];
  private connectListeners: Array<() => void> = [];

  emit(event: string, payload: unknown = {}): void {
    if (this.connected) this.wire.push(event);
    else this.buffer.push({ event, payload }); // ← socket.io 的缓冲行为
  }

  onConnect(cb: () => void): void {
    this.connectListeners.push(cb);
  }

  connect(): void {
    this.connected = true;
    for (const b of this.buffer) this.wire.push(b.event); // emitBuffered()
    this.buffer = [];
    for (const cb of this.connectListeners) cb(); // emitReserved('connect')
  }

  disconnect(): void {
    this.connected = false;
  }
}

const HELLO = 'c:hello';
const CREATE = 'c:create_room';
const CLAIM = 'c:claim_oracle';
const READY = 'c:set_ready';

/* ═══════════════════════════════════════════════════════════════════════════
 * 修复前:业务事件直接 socket.emit,c:hello 在 'connect' 监听器里发
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('修复前的实现 —— 这组断言证明竞态真的存在', () => {
  function legacyWiring() {
    const socket = new FakeSocketIO();
    socket.onConnect(() => socket.emit(HELLO)); // ← session 1/2 的写法
    return {
      socket,
      /** 业务事件直发,没有闸门。 */
      send: (event: string) => socket.emit(event),
    };
  }

  it('首次连接是好的 —— 所以这条 bug 平时看不见', () => {
    const { socket, send } = legacyWiring();
    socket.connect();
    send(CREATE);
    expect(socket.wire).toEqual([HELLO, CREATE]);
  });

  it('**断线期间点一下,重连后 c:create_room 抢在 c:hello 前面**', () => {
    const { socket, send } = legacyWiring();
    socket.connect();
    socket.disconnect();

    send(CREATE); // 用户点了「建房」,socket.io 把它缓冲起来

    socket.connect(); // 重连:先冲缓冲区,再叫 connect 监听器

    // 这就是线上看到的顺序 —— server 收到 create_room 时还不认得这个 socket
    expect(socket.wire).toEqual([HELLO, CREATE, HELLO]);
    const afterReconnect = socket.wire.slice(1);
    expect(afterReconnect[0]).toBe(CREATE); // ← 业务事件先到
    expect(afterReconnect[1]).toBe(HELLO); // ← 认领后到,已经晚了
  });

  it('攒了几条就翻几条 —— 全部排在认领前面', () => {
    const { socket, send } = legacyWiring();
    socket.connect();
    socket.disconnect();

    send(CREATE);
    send(CLAIM);
    send(READY);
    socket.connect();

    expect(socket.wire.slice(1)).toEqual([CREATE, CLAIM, READY, HELLO]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 修复后:IdentityGate
 * ═══════════════════════════════════════════════════════════════════════════ */

function gatedWiring(opts: { maxQueue?: number } = {}) {
  const socket = new FakeSocketIO();
  const states: GateState[] = [];
  const overflowed: QueuedEvent[] = [];

  const gate = new IdentityGate({
    transport: socket,
    identify: () => ({ event: HELLO, payload: { playerId: 'pid-A' } }),
    onStateChange: (s) => states.push(s),
    onOverflow: (e) => overflowed.push(e),
    ...(opts.maxQueue !== undefined ? { maxQueue: opts.maxQueue } : {}),
  });

  socket.onConnect(() => gate.handleConnect());
  /** 模拟 server 回 s:hello_ok。 */
  const ack = () => gate.handleIdentified();
  const drop = () => {
    socket.disconnect();
    gate.handleDisconnect();
  };
  return { socket, gate, states, overflowed, ack, drop };
}

describe('修复后 —— 认领永远第一个上线', () => {
  it('**同一个场景:重连后 c:hello 在前,业务事件在后**', () => {
    const { socket, gate, ack, drop } = gatedWiring();
    socket.connect();
    ack();
    drop();

    gate.send(CREATE); // 断线期间点的 —— 现在压在 gate 的队列里,没进 socket.io

    socket.connect(); // 重连:gate.handleConnect() 直发 c:hello
    expect(socket.wire.slice(1)).toEqual([HELLO]); // 业务事件还没放行

    ack(); // 收到 s:hello_ok
    expect(socket.wire.slice(1)).toEqual([HELLO, CREATE]); // ← 顺序对了
  });

  it('未认领时业务事件**一条都不上线**(不变量 2)', () => {
    const { socket, gate } = gatedWiring();
    gate.send(CREATE);
    gate.send(CLAIM);
    expect(socket.wire).toEqual([]);

    socket.connect();
    expect(socket.wire).toEqual([HELLO]); // 连上了但还没确认 —— 仍然只有认领
  });

  it('冲队列按 FIFO,不乱序', () => {
    const { socket, gate, ack } = gatedWiring();
    gate.send(CREATE);
    gate.send(CLAIM);
    gate.send(READY);
    socket.connect();
    ack();
    expect(socket.wire).toEqual([HELLO, CREATE, CLAIM, READY]);
  });

  it('已认领后直发,不再排队', () => {
    const { socket, gate, ack } = gatedWiring();
    socket.connect();
    ack();
    gate.send(CREATE);
    expect(socket.wire).toEqual([HELLO, CREATE]);
    expect(gate.queuedCount).toBe(0);
  });

  it('每次重连都重发认领 —— 稳定 playerId 重绑新 socket(SPEC §7)', () => {
    const { socket, ack, drop } = gatedWiring();
    socket.connect();
    ack();
    drop();
    socket.connect();
    ack();
    expect(socket.wire.filter((e) => e === HELLO)).toHaveLength(2);
  });

  it('断线后闸门重新关上 —— 不会因为「上次认领过」就直发', () => {
    const { socket, gate, ack, drop } = gatedWiring();
    socket.connect();
    ack();
    expect(gate.isReady).toBe(true);

    drop();
    expect(gate.isReady).toBe(false);

    gate.send(CLAIM);
    expect(socket.wire.filter((e) => e === CLAIM)).toHaveLength(0); // 压住了
  });

  it('状态流转可观测,UI 能据此禁用按钮(排队之外还要有可见反馈)', () => {
    const { socket, states, ack, drop } = gatedWiring();
    socket.connect();
    ack();
    drop();
    socket.connect();
    ack();
    expect(states).toEqual(['identifying', 'ready', 'offline', 'identifying', 'ready']);
  });
});

describe('不静默丢(不变量 3)', () => {
  it('队列满了会**报出来**,不是悄悄扔掉', () => {
    const { gate, overflowed } = gatedWiring({ maxQueue: 2 });
    gate.send(CREATE);
    gate.send(CLAIM);
    gate.send(READY); // 第三条越界

    expect(gate.queuedCount).toBe(2);
    expect(overflowed).toEqual([{ event: READY, payload: {} }]);
  });

  it('没越界就一条都不丢', () => {
    const { socket, gate, overflowed, ack } = gatedWiring({ maxQueue: 8 });
    for (let i = 0; i < 8; i++) gate.send(`c:evt_${i}`);
    socket.connect();
    ack();
    expect(overflowed).toEqual([]);
    expect(socket.wire.slice(1)).toHaveLength(8);
  });

  it('discardQueued 是显式的,不会自己发生', () => {
    const { gate } = gatedWiring();
    gate.send(CREATE);
    expect(gate.discardQueued()).toEqual([{ event: CREATE, payload: {} }]);
    expect(gate.queuedCount).toBe(0);
  });
});

describe('契约对照 —— 同一场景,两种实现', () => {
  /**
   * 把 bug 压成一句话:**断线期间发生的第一个动作,重连后必须排在认领之后。**
   * 这条断言是给别的 repo 抄的。
   */
  const contract = (wireAfterReconnect: string[]) => wireAfterReconnect[0] === HELLO;

  it('旧实现违反契约,gate 满足契约', () => {
    // 旧
    const legacy = new FakeSocketIO();
    legacy.onConnect(() => legacy.emit(HELLO));
    legacy.connect();
    legacy.disconnect();
    legacy.emit(CREATE);
    legacy.connect();
    expect(contract(legacy.wire.slice(1))).toBe(false);

    // 新
    const { socket, gate, ack, drop } = gatedWiring();
    socket.connect();
    ack();
    drop();
    gate.send(CREATE);
    socket.connect();
    ack();
    expect(contract(socket.wire.slice(1))).toBe(true);
  });

  it('identify 每次都重新取(名字可能在 lobby 里被改过)', () => {
    const identify = vi.fn(() => ({ event: HELLO, payload: {} }));
    const socket = new FakeSocketIO();
    const gate = new IdentityGate({ transport: socket, identify });
    socket.onConnect(() => gate.handleConnect());

    socket.connect();
    gate.handleIdentified();
    socket.disconnect();
    gate.handleDisconnect();
    socket.connect();

    expect(identify).toHaveBeenCalledTimes(2); // 不是建 gate 时取一次就完事
  });
});
