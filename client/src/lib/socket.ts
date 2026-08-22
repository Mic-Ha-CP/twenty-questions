/**
 * Socket 客户端。
 *
 * 两条纪律:
 *  · 后端地址**只能**来自 env(`VITE_SERVER_URL`)—— 源码里永不写死别的 repo 的
 *    部署地址(CONVENTIONS.md)。
 *  · **client 不做乐观更新。** 所有 emit 都是「提请求」,渲染一律等
 *    `s:room_state` 广播回来。座位申领尤其如此:先到先得由 server 裁决,
 *    本地抢先画上去只会在被拒时闪一下。
 */

import { io, type Socket } from 'socket.io-client';
import { C2S } from '@shared/events';
import { getIdentity } from './nickname';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3002';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(SERVER_URL, {
    autoConnect: true,
    transports: ['websocket', 'polling'],
  });

  // 每次(重)连都重新认领身份 —— 稳定 playerId 重绑新 socket(SPEC §7)。
  socket.on('connect', () => {
    const { playerId, nickname } = getIdentity();
    socket?.emit(C2S.HELLO, { playerId, nickname });
  });

  return socket;
}

export function disposeSocket(): void {
  socket?.disconnect();
  socket = null;
}
