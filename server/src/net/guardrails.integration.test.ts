/**
 * 护栏的集成测试 —— 真 socket.io,真拒连。
 *
 * 单测钉的是判定逻辑;这里钉的是**接线**:
 * 判定说「拒」的时候,连接是不是真的被拒了。
 *
 * 每个 describe 起一台自己的 server,因为阈值不一样。
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { Server } from 'socket.io';
import { afterEach, describe, expect, it } from 'vitest';
import { C2S, S2C } from '@shared/events';
import { guardrailsFromEnv, type GuardrailConfig } from './guardrails';
import { attachSocketLayer } from '../socket/index';

const PROD_ORIGIN = 'https://twenty-questions-swart.vercel.app';

interface Harness {
  port: number;
  close: () => Promise<void>;
}

const open: Harness[] = [];
const clients: ClientSocket[] = [];

async function boot(opts: {
  enforceOrigin?: boolean;
  guardrails?: Partial<GuardrailConfig>;
}): Promise<Harness> {
  const httpServer = http.createServer();
  const limits = { ...guardrailsFromEnv({}), ...opts.guardrails };
  const io = new Server(httpServer, {
    cors: { origin: [PROD_ORIGIN] },
    maxHttpBufferSize: limits.maxPayloadBytes,
  });
  const layer = attachSocketLayer(io, {
    allowedOrigins: [PROD_ORIGIN],
    enforceOrigin: opts.enforceOrigin ?? false,
    guardrails: limits,
  });
  await new Promise<void>((r) => httpServer.listen(0, r));
  const h: Harness = {
    port: (httpServer.address() as AddressInfo).port,
    close: async () => {
      layer.dispose();
      io.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
  open.push(h);
  return h;
}

afterEach(async () => {
  while (clients.length) clients.pop()?.disconnect();
  while (open.length) await open.pop()!.close();
});

/** 尝试连接,回报成功还是被拒。 */
function tryConnect(port: number, origin?: string): Promise<'connected' | string> {
  return new Promise((resolve) => {
    const s = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      ...(origin ? { extraHeaders: { Origin: origin } } : {}),
    });
    clients.push(s);
    s.on('connect', () => resolve('connected'));
    s.on('connect_error', (e) => resolve(e.message));
    setTimeout(() => resolve('timeout'), 4000);
  });
}

/* ═══════════════════════ Origin 检查:三条 ═══════════════════════ */

describe('Origin 检查(生产开启)', () => {
  it('**伪 Origin —— 别人的网站借我们后端 → 拒**', async () => {
    const h = await boot({ enforceOrigin: true });
    expect(await tryConnect(h.port, 'https://evil.example.com')).toBe('origin_not_allowed');
  });

  it('**正确 Origin → 过**', async () => {
    const h = await boot({ enforceOrigin: true });
    expect(await tryConnect(h.port, PROD_ORIGIN)).toBe('connected');
  });

  /**
   * **记录现状:无 Origin(curl / node 脚本)一律放行。**
   *
   * 这是有意的设计,不是漏网 —— 浏览器永远发 Origin,所以「别人的网站」挡得住;
   * 脚本本来就能随便写 Origin,拒绝空 Origin 只会挡住我们自己的 smoke 脚本,
   * 换不到任何真实保护。**这道门是给浏览器的,对脚本从来不设防。**
   */
  it('**无 Origin(脚本)→ 放行** —— 现状如此,且是刻意的', async () => {
    const h = await boot({ enforceOrigin: true });
    expect(await tryConnect(h.port)).toBe('connected');
  });

  it('末尾斜杠不影响', async () => {
    const h = await boot({ enforceOrigin: true });
    expect(await tryConnect(h.port, `${PROD_ORIGIN}/`)).toBe('connected');
  });

  it('dev(不启用)时伪 Origin 也放行 —— 否则本地各种试都被挡', async () => {
    const h = await boot({ enforceOrigin: false });
    expect(await tryConnect(h.port, 'https://evil.example.com')).toBe('connected');
  });
});

/* ═══════════════════════ per-IP 并发连接 ═══════════════════════ */

describe('per-IP 并发连接上限', () => {
  it('**到上限之后新连接被拒**', async () => {
    const h = await boot({ guardrails: { maxConnectionsPerIp: 2 } });
    expect(await tryConnect(h.port)).toBe('connected');
    expect(await tryConnect(h.port)).toBe('connected');
    expect(await tryConnect(h.port)).toBe('too_many_connections');
  });

  it('**断开之后名额还回来**(否则玩几轮就再也连不上了)', async () => {
    const h = await boot({ guardrails: { maxConnectionsPerIp: 1 } });
    const first = ioc(`http://localhost:${h.port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    clients.push(first);
    await new Promise<void>((r) => first.on('connect', () => r()));

    expect(await tryConnect(h.port)).toBe('too_many_connections');

    first.disconnect();
    await new Promise((r) => setTimeout(r, 250));
    expect(await tryConnect(h.port)).toBe('connected');
  });

  it('默认 20 —— 朋友局怎么玩都碰不到', async () => {
    expect(guardrailsFromEnv({}).maxConnectionsPerIp).toBe(20);
  });
});

/* ═══════════════════════ 事件速率 ═══════════════════════ */

describe('per-socket 事件速率', () => {
  it('**超限:丢事件 + 回 RATE_LIMITED,但连接留着**', async () => {
    const h = await boot({ guardrails: { eventRatePerSec: 1, burst: 3 } });
    const s = ioc(`http://localhost:${h.port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    clients.push(s);
    const errors: string[] = [];
    s.on(S2C.ERROR, (e: { code: string }) => errors.push(e.code));
    await new Promise<void>((r) => s.on('connect', () => r()));

    // 桶容量 3,连发 12 条
    for (let i = 0; i < 12; i++) s.emit(C2S.LOBBY_SUBSCRIBE);
    await new Promise((r) => setTimeout(r, 400));

    expect(errors.filter((e) => e === 'RATE_LIMITED').length).toBeGreaterThan(0);
    // ★ 最要紧的一条:**没有被踢下线**
    expect(s.connected).toBe(true);
  });

  it('正常节奏不会触发', async () => {
    const h = await boot({});
    const s = ioc(`http://localhost:${h.port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    clients.push(s);
    const errors: string[] = [];
    s.on(S2C.ERROR, (e: { code: string }) => errors.push(e.code));
    await new Promise<void>((r) => s.on('connect', () => r()));

    s.emit(C2S.HELLO, { playerId: 'p1', nickname: 'A' });
    await new Promise((r) => setTimeout(r, 100));
    s.emit(C2S.CREATE_ROOM, { isPrivate: true });
    await new Promise((r) => setTimeout(r, 300));

    expect(errors).not.toContain('RATE_LIMITED');
  });

  it('**判定桶更宽** —— oracle 连点清队列不该被普通速率挡住', async () => {
    const c = guardrailsFromEnv({});
    expect(c.judgeRatePerSec).toBeGreaterThan(c.eventRatePerSec);
  });
});

/* ═══════════════════════ payload 上限 ═══════════════════════ */

describe('maxHttpBufferSize', () => {
  it('默认压到 64KB(socket.io 默认是 1MB)', () => {
    expect(guardrailsFromEnv({}).maxPayloadBytes).toBe(64 * 1024);
  });

  it('**超大 payload 连不进来** —— 合法内容最大也就一段还原叙述', async () => {
    const h = await boot({ guardrails: { maxPayloadBytes: 1024 } });
    const s = ioc(`http://localhost:${h.port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    clients.push(s);
    await new Promise<void>((r) => s.on('connect', () => r()));

    const dropped = new Promise<boolean>((resolve) => {
      s.on('disconnect', () => resolve(true));
      setTimeout(() => resolve(false), 2500);
    });
    s.emit(C2S.ASK_QUESTION, { text: 'x'.repeat(50_000) });

    expect(await dropped).toBe(true);
  });

  it('正常大小的还原提交不受影响', async () => {
    const h = await boot({});
    const s = ioc(`http://localhost:${h.port}`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    clients.push(s);
    await new Promise<void>((r) => s.on('connect', () => r()));

    s.emit(C2S.SUBMIT_SOLUTION, { text: '还'.repeat(600) }); // 上限那么长的一段
    await new Promise((r) => setTimeout(r, 300));
    expect(s.connected).toBe(true);
  });
});
