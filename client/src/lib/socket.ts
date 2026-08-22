/**
 * Socket 客户端。
 *
 * 三条纪律:
 *  · 后端地址**只能**来自 env(`VITE_SERVER_URL`)—— 源码里永不写死别的 repo 的
 *    部署地址(CONVENTIONS.md)。
 *  · **client 不做乐观更新。** 所有 emit 都是「提请求」,渲染一律等
 *    `s:room_state` 广播回来。
 *  · **业务事件一律走 `sendGated()`,不许直接 `socket.emit`。**
 *    直接 emit 会把 NOTES 待决 #7 那条重连竞态放回来 —— 见 `identityGate.ts`。
 */

import { io, type Socket } from 'socket.io-client';
import { C2S, S2C } from '@shared/events';
import { IdentityGate, type GateState, type QueuedEvent } from './identityGate';
import { getIdentity } from './nickname';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3002';

let socket: Socket | null = null;
let gate: IdentityGate | null = null;

/** gate 状态的订阅者(store 用它驱动 UI 的可用状态)。 */
const stateListeners = new Set<(s: GateState) => void>();
/** 溢出上报 —— **不静默丢**的落点。 */
const overflowListeners = new Set<(e: QueuedEvent) => void>();

export function onGateState(cb: (s: GateState) => void): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

export function onGateOverflow(cb: (e: QueuedEvent) => void): () => void {
  overflowListeners.add(cb);
  return () => overflowListeners.delete(cb);
}

function build(): { socket: Socket; gate: IdentityGate } {
  const s = io(SERVER_URL, {
    autoConnect: true,
    transports: ['websocket', 'polling'],
  });

  const g = new IdentityGate({
    transport: { emit: (event, payload) => s.emit(event, payload) },
    // 每次(重)连都重新取 —— 名字可能在 lobby 里被改过(SPEC §7 / ADR-10)。
    identify: () => {
      const { playerId, nickname } = getIdentity();
      return { event: C2S.HELLO, payload: { playerId, nickname } };
    },
    onStateChange: (st) => stateListeners.forEach((cb) => cb(st)),
    onOverflow: (e) => overflowListeners.forEach((cb) => cb(e)),
  });

  // 顺序就是这条 bug 的全部:gate 在 'connect' 里直发认领,业务事件在它之后才放行。
  s.on('connect', () => g.handleConnect());
  s.on('disconnect', () => g.handleDisconnect());
  s.on(S2C.HELLO_OK, () => g.handleIdentified());

  return { socket: s, gate: g };
}

export function getSocket(): Socket {
  if (!socket) ({ socket, gate } = build());
  return socket;
}

function getGate(): IdentityGate {
  if (!gate) ({ socket, gate } = build());
  return gate;
}

/** **业务事件的唯一出口。** */
export function sendGated(event: string, payload: unknown = {}): void {
  getSocket(); // 确保连接已建立
  getGate().send(event, payload);
}

export function gateState(): GateState {
  return getGate().state;
}

export function disposeSocket(): void {
  socket?.disconnect();
  socket = null;
  gate = null;
}
