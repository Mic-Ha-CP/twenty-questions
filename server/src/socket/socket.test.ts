/**
 * Socket 层集成测试 —— session 1 那个一次性冒烟脚本的固化版。
 *
 * 单测覆盖不到的东西在这里:choke point 有没有真的广播、per-viewer 投影有没有
 * 按人发对、**并发申领在真实 socket 路径上是不是仍然先到先得**。
 *
 * 用真 socket.io,不 mock —— mock 掉传输就等于不测这一层。
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { Server } from 'socket.io';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { C2S, S2C } from '@shared/events';
import type { RoomState, RoomSummary } from '@shared/types';
import type { RoomManager } from '../room/RoomManager';
import { attachSocketLayer } from './index';

let httpServer: http.Server;
let io: Server;
let dispose: () => void;
let manager: RoomManager;
let port: number;
const clients: ClientSocket[] = [];

/** 广播窗口是 50ms —— 给它一点余量再断言。 */
const settle = (ms = 140) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  httpServer = http.createServer();
  io = new Server(httpServer, { cors: { origin: '*' } });
  const layer = attachSocketLayer(io);
  dispose = layer.dispose;
  manager = layer.manager;
  await new Promise<void>((r) => httpServer.listen(0, r));
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  dispose();
  io.close();
  await new Promise<void>((r) => httpServer.close(() => r()));
});

afterEach(() => {
  while (clients.length) clients.pop()?.disconnect();
  // 测试之间必须清房:playerId 是稳定的,留着房的话下一个 test 的 c:hello
  // 会把人自动塞回上一个 test 的房间(session 1 的冒烟脚本就被这个坑过一次)。
  for (const room of manager.allRooms()) manager.remove(room.code, 'empty');
});

/** 每个 client 把收到的事件全存下来,避免「监听器注册晚了」这种测试脚本 bug。 */
interface Probe {
  s: ClientSocket;
  /** `s:hello_ok` 的 payload —— 幽灵房间那组用它。 */
  hello: { playerId: string; roomCode: string | null } | null;
  states: RoomState[];
  errors: string[];
  lobby: RoomSummary[][];
  closed: number;
  kicked: number;
  state(): RoomState;
  lastLobby(): RoomSummary[];
  clearErrors(): void;
}

async function connect(playerId: string, nickname: string): Promise<Probe> {
  const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  clients.push(s);

  const p: Probe = {
    s,
    hello: null,
    states: [],
    errors: [],
    lobby: [],
    closed: 0,
    kicked: 0,
    state: () => p.states[p.states.length - 1]!,
    lastLobby: () => p.lobby[p.lobby.length - 1]!,
    clearErrors: () => {
      p.errors.length = 0;
    },
  };

  s.on(S2C.ROOM_STATE, (v: RoomState) => p.states.push(v));
  s.on(S2C.ERROR, (v: { code: string }) => p.errors.push(v.code));
  s.on(S2C.LOBBY_LIST, (v: { rooms: RoomSummary[] }) => p.lobby.push(v.rooms));
  s.on(S2C.ROOM_CLOSED, () => p.closed++);
  s.on(S2C.KICKED, () => p.kicked++);

  await new Promise<void>((r) => s.on('connect', () => r()));
  s.emit(C2S.HELLO, { playerId, nickname });
  await new Promise<void>((r) =>
    s.once(S2C.HELLO_OK, (payload: { playerId: string; roomCode: string | null }) => {
      p.hello = payload;
      r();
    }),
  );
  return p;
}

describe('身份与 lobby 频道', () => {
  it('hello 之后才认得这个 socket;没 hello 就操作 = INVALID_PAYLOAD', async () => {
    const s = ioc(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    clients.push(s);
    const errors: string[] = [];
    s.on(S2C.ERROR, (v: { code: string }) => errors.push(v.code));
    await new Promise<void>((r) => s.on('connect', () => r()));

    s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    expect(errors).toEqual(['INVALID_PAYLOAD']);
  });

  it('订阅 lobby 立刻拿到快照(规则 4:不合并不去重)', async () => {
    const l = await connect('pid-L', '旁观者');
    l.s.emit(C2S.LOBBY_SUBSCRIBE);
    await settle(60);
    expect(l.lobby).toHaveLength(1); // 立即到达,没等 50ms 窗口
  });
});

describe('幽灵房间:认领成功,但房间已经不在了', () => {
  /**
   * 本地 smoke 实测发现的:server 重启后 client 自动重连、`c:hello` 也成功了,
   * 但它记着的那个房间已经随进程一起蒸发(ADR-12:零持久化)。
   * 旧行为是 client 留在死屏上,每点一下收一条「你不在房间里」——
   * 用户看到的是一个永远不动的界面。
   *
   * 修法:**`s:hello_ok` 直接告诉 client 它现在在哪个房间(或者哪儿都不在)**,
   * client 据此自己退回 landing。server 不需要知道 client 记着什么。
   */
  it('**`s:hello_ok` 带上 roomCode** —— 人在房里就给码', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const code = a.state().code;

    // 同一个 playerId 换条 socket 回来(断线重连)
    const again = await connect('pid-A', '甲');
    expect(again.hello?.roomCode).toBe(code);
  });

  it('**房间没了 → roomCode 是 null**,而不是让 client 自己去猜', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const code = a.state().code;

    // 模拟 server 重启:房间随进程蒸发
    manager.remove(code, 'empty');

    const again = await connect('pid-A', '甲');
    expect(again.hello?.roomCode).toBeNull();
  });

  it('从来没进过房的人,roomCode 也是 null', async () => {
    const fresh = await connect('pid-Z', '路人');
    expect(fresh.hello?.roomCode).toBeNull();
  });

  it('房间没了之后,后续操作仍然是 NOT_IN_ROOM(server 侧行为不变)', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    manager.remove(a.state().code, 'empty');

    const again = await connect('pid-A', '甲');
    again.clearErrors();
    again.s.emit(C2S.SET_READY, { ready: true });
    await settle();
    expect(again.errors).toEqual(['NOT_IN_ROOM']);
  });
});

describe('建房 / 加入(12 步冒烟的固化)', () => {
  it('建房 → 房主就位、oracle 空、phase=lobby、lobby 列表更新', async () => {
    const l = await connect('pid-L', '旁观者');
    l.s.emit(C2S.LOBBY_SUBSCRIBE);
    await settle(60);
    const before = l.lastLobby().length;

    const a = await connect('pid-A', '沉默的侦探');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();

    expect(a.state().phase).toBe('lobby');
    expect(a.state().oracleId).toBeNull();
    expect(a.state().hostId).toBe('pid-A');
    expect(a.state().viewerId).toBe('pid-A'); // per-viewer 投影
    expect(l.lastLobby()).toHaveLength(before + 1);
  });

  it('**lobby 行只有 whitelist 的 8 个字段**', async () => {
    const l = await connect('pid-L', '旁观者');
    l.s.emit(C2S.LOBBY_SUBSCRIBE);
    const a = await connect('pid-A', '沉默的侦探');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();

    const row = l.lastLobby()[0]!;
    expect(Object.keys(row).sort()).toEqual(
      [
        'code',
        'displayNumber',
        'hasOracle',
        'hostNickname',
        'maxPlayers',
        'phase',
        'playerCount',
        'puzzleType',
      ].sort(),
    );
    expect(row).not.toHaveProperty('settings');
    expect(row).not.toHaveProperty('players');
    expect(row).not.toHaveProperty('oracleId');
  });

  it('加入 → 撞名被 server 端重摇,两人都收到自己那份 state', async () => {
    const a = await connect('pid-A', '沉默的侦探');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const code = a.state().code;

    const b = await connect('pid-B', '沉默的侦探'); // 故意撞名
    b.s.emit(C2S.JOIN_ROOM, { code });
    await settle();

    const names = b.state().players.map((p) => p.nickname);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2); // 重摇过了
    expect(b.state().viewerId).toBe('pid-B');
    expect(a.state().players).toHaveLength(2); // A 也收到了更新
  });

  it('加入不存在的房 → ROOM_NOT_FOUND', async () => {
    const b = await connect('pid-B', '多疑的证人');
    b.s.emit(C2S.JOIN_ROOM, { code: '0000' });
    await settle();
    expect(b.errors).toContain('ROOM_NOT_FOUND');
  });
});

describe('并发申领 oracle 座位 —— 真实 socket 路径(必测 7)', () => {
  it('**同一 tick 两个申领:一个成功,后到者收 SEAT_TAKEN**', async () => {
    const a = await connect('pid-A', '沉默的侦探');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const code = a.state().code;

    const b = await connect('pid-B', '多疑的证人');
    b.s.emit(C2S.JOIN_ROOM, { code });
    await settle();

    a.clearErrors();
    b.clearErrors();
    a.s.emit(C2S.CLAIM_ORACLE);
    b.s.emit(C2S.CLAIM_ORACLE);
    await settle();

    const seated = a.state().oracleId;
    expect(seated).not.toBeNull();
    // 恰好一个人拿到座位,另一个恰好收到一条 SEAT_TAKEN
    const losers = [a, b].filter((p) => p.errors.includes('SEAT_TAKEN'));
    expect(losers).toHaveLength(1);
    expect(a.state().oracleId).toBe(b.state().oracleId); // 两边看到的是同一个事实
  });

  it('三人同时抢 → 只有一个成功,另外两个都是 SEAT_TAKEN', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const code = a.state().code;

    const b = await connect('pid-B', '乙');
    const c = await connect('pid-C', '丙');
    b.s.emit(C2S.JOIN_ROOM, { code });
    c.s.emit(C2S.JOIN_ROOM, { code });
    await settle();

    [a, b, c].forEach((p) => p.clearErrors());
    a.s.emit(C2S.CLAIM_ORACLE);
    b.s.emit(C2S.CLAIM_ORACLE);
    c.s.emit(C2S.CLAIM_ORACLE);
    await settle();

    const taken = [a, b, c].filter((p) => p.errors.includes('SEAT_TAKEN'));
    expect(taken).toHaveLength(2);
    expect(a.state().oracleId).not.toBeNull();
  });

  it('host 改派可以覆盖已占座位', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const b = await connect('pid-B', '乙');
    b.s.emit(C2S.JOIN_ROOM, { code: a.state().code });
    await settle();

    b.s.emit(C2S.CLAIM_ORACLE);
    await settle();
    expect(a.state().oracleId).toBe('pid-B');

    a.s.emit(C2S.ASSIGN_ORACLE, { playerId: 'pid-A' });
    await settle();
    expect(a.state().oracleId).toBe('pid-A');
  });
});

describe('start gate 三种拒绝(必测 5)', () => {
  async function twoPlayerRoom() {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const b = await connect('pid-B', '乙');
    b.s.emit(C2S.JOIN_ROOM, { code: a.state().code });
    await settle();
    return { a, b };
  }

  it('人不够 → NOT_ENOUGH_PLAYERS', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    a.clearErrors();
    a.s.emit(C2S.START_GAME);
    await settle();
    expect(a.errors).toEqual(['NOT_ENOUGH_PLAYERS']);
  });

  it('没人坐 oracle → NO_ORACLE_SEATED', async () => {
    const { a, b } = await twoPlayerRoom();
    a.s.emit(C2S.SET_READY, { ready: true });
    b.s.emit(C2S.SET_READY, { ready: true });
    await settle();
    a.clearErrors();
    a.s.emit(C2S.START_GAME);
    await settle();
    expect(a.errors).toEqual(['NO_ORACLE_SEATED']);
  });

  it('有人没 ready → NOT_ALL_READY(含 oracle 自己)', async () => {
    const { a, b } = await twoPlayerRoom();
    b.s.emit(C2S.CLAIM_ORACLE);
    b.s.emit(C2S.SET_READY, { ready: true });
    await settle();

    a.clearErrors();
    a.s.emit(C2S.START_GAME);
    await settle();
    expect(a.errors).toEqual(['NOT_ALL_READY']); // host 自己没 ready

    a.s.emit(C2S.SET_READY, { ready: true });
    await settle();
    a.clearErrors();
    a.s.emit(C2S.START_GAME);
    await settle();
    expect(a.errors).toEqual([]);
    expect(a.state().phase).toBe('setup');
  });
});

describe('权限与 phase 守卫', () => {
  it('非 host 踢人 / 改设置 → NOT_HOST', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const b = await connect('pid-B', '乙');
    b.s.emit(C2S.JOIN_ROOM, { code: a.state().code });
    await settle();

    b.clearErrors();
    b.s.emit(C2S.KICK_PLAYER, { playerId: 'pid-A' });
    b.s.emit(C2S.UPDATE_SETTINGS, { maxPlayers: 4 });
    await settle();
    expect(b.errors).toEqual(['NOT_HOST', 'NOT_HOST']);
  });

  it('被踢的人收到 KICKED 并离开房间', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const b = await connect('pid-B', '乙');
    b.s.emit(C2S.JOIN_ROOM, { code: a.state().code });
    await settle();

    a.s.emit(C2S.KICK_PLAYER, { playerId: 'pid-B' });
    await settle();
    expect(b.kicked).toBe(1);
    expect(a.state().players).toHaveLength(1);
  });

  it('setup phase 拒改设置 → NOT_LOBBY_PHASE', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const b = await connect('pid-B', '乙');
    b.s.emit(C2S.JOIN_ROOM, { code: a.state().code });
    await settle();

    b.s.emit(C2S.CLAIM_ORACLE);
    a.s.emit(C2S.SET_READY, { ready: true });
    b.s.emit(C2S.SET_READY, { ready: true });
    await settle();
    a.s.emit(C2S.START_GAME);
    await settle();
    expect(a.state().phase).toBe('setup');

    a.clearErrors();
    a.s.emit(C2S.UPDATE_SETTINGS, { maxPlayers: 4 });
    await settle();
    expect(a.errors).toEqual(['NOT_LOBBY_PHASE']);
  });
});

describe('私密房不入 lobby 列表(通用面 #7)', () => {
  it('私密房 displayNumber=null 且不出现在列表里,但能靠码进', async () => {
    const l = await connect('pid-L', '旁观者');
    l.s.emit(C2S.LOBBY_SUBSCRIBE);
    await settle(60);
    const before = l.lastLobby().length;

    const a = await connect('pid-A', '暗房客');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: true });
    await settle();

    expect(a.state().displayNumber).toBeNull();
    expect(l.lastLobby()).toHaveLength(before); // ← 没进列表

    const b = await connect('pid-B', '循码的人');
    b.s.emit(C2S.JOIN_ROOM, { code: a.state().code });
    await settle();
    expect(b.state().players).toHaveLength(2); // 码是对的就进得去
  });
});

describe('断线与重连(必测 9)', () => {
  it('断线只打标记,人还在房里', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const b = await connect('pid-B', '乙');
    b.s.emit(C2S.JOIN_ROOM, { code: a.state().code });
    await settle();

    b.s.disconnect();
    await settle();

    expect(a.state().players).toHaveLength(2);
    expect(a.state().players.find((p) => p.id === 'pid-B')!.connected).toBe(false);
  });

  it('**重连:同一 playerId 重新绑上新 socket,不当新人**', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    await settle();
    const b1 = await connect('pid-B', '乙');
    b1.s.emit(C2S.JOIN_ROOM, { code: a.state().code });
    await settle();

    b1.s.disconnect();
    await settle();

    const b2 = await connect('pid-B', '乙'); // 新 socket,同一 playerId
    await settle();

    expect(a.state().players).toHaveLength(2); // 没多出一个人
    expect(a.state().players.find((p) => p.id === 'pid-B')!.connected).toBe(true);
    expect(b2.state().code).toBe(a.state().code); // 自动回到原房间
  });
});

describe('i18n 纪律:server 不发展示字符串(必测 10)', () => {
  it('错误事件只带语义 code', async () => {
    const a = await connect('pid-A', '甲');
    a.s.emit(C2S.JOIN_ROOM, { code: '0000' });
    await settle();
    expect(a.errors).toEqual(['ROOM_NOT_FOUND']);
    expect(a.errors[0]).toMatch(/^[A-Z_]+$/); // 全大写下划线 = enum,不是人话
  });

  it('**room_state / lobby_list 里没有中文** —— 昵称除外(用户产出内容)', async () => {
    const a = await connect('pid-A', 'AAA');
    a.s.emit(C2S.CREATE_ROOM, { isPrivate: false });
    const l = await connect('pid-L', 'LLL');
    l.s.emit(C2S.LOBBY_SUBSCRIBE);
    await settle();

    const cjk = /[一-鿿]/;
    expect(cjk.test(JSON.stringify(a.state()))).toBe(false);
    expect(cjk.test(JSON.stringify(l.lastLobby()))).toBe(false);
  });
});
