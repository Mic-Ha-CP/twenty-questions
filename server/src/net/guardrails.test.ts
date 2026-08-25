/**
 * 网络层护栏的单元测试。
 *
 * 定位提醒:这些东西是**随机扫描器保险**,不是抗定向攻击。
 * 用例也照这个定位写 —— 断言的是「挡住浏览器里的别人家网站」和
 * 「挡住手抖/巨型 payload」,**不断言**挡得住脚本(挡不住,而且我们知道)。
 */

import { describe, expect, it } from 'vitest';
import {
  ConnectionCounter,
  TokenBucket,
  checkOrigin,
  clientIpOf,
  guardrailsFromEnv,
  isJudgeEvent,
} from './guardrails';

/* ═══════════════════════ 配置 ═══════════════════════ */

describe('阈值走 env,线上不改代码就能调', () => {
  it('不给 env 时用默认值', () => {
    expect(guardrailsFromEnv({})).toEqual({
      maxConnectionsPerIp: 20,
      eventRatePerSec: 10,
      judgeRatePerSec: 30,
      burst: 20,
      maxPayloadBytes: 65536,
    });
  });

  it('env 能覆盖每一项', () => {
    const c = guardrailsFromEnv({
      MAX_CONNECTIONS_PER_IP: '5',
      EVENT_RATE_PER_SEC: '3',
      JUDGE_RATE_PER_SEC: '9',
      EVENT_BURST: '7',
      MAX_PAYLOAD_BYTES: '1024',
    });
    expect(c).toEqual({
      maxConnectionsPerIp: 5,
      eventRatePerSec: 3,
      judgeRatePerSec: 9,
      burst: 7,
      maxPayloadBytes: 1024,
    });
  });

  it('**垃圾值退回默认**,不会把上限设成 0 或 NaN 把游戏锁死', () => {
    const c = guardrailsFromEnv({
      MAX_CONNECTIONS_PER_IP: 'abc',
      EVENT_RATE_PER_SEC: '0',
      JUDGE_RATE_PER_SEC: '-5',
      MAX_PAYLOAD_BYTES: '',
    });
    expect(c.maxConnectionsPerIp).toBe(20);
    expect(c.eventRatePerSec).toBe(10);
    expect(c.judgeRatePerSec).toBe(30);
    expect(c.maxPayloadBytes).toBe(65536);
  });

  it('默认 payload 上限远大于最大的合法内容(600 字的还原)', () => {
    expect(guardrailsFromEnv({}).maxPayloadBytes).toBeGreaterThan(600 * 4);
  });
});

/* ═══════════════════════ Origin 检查 ═══════════════════════ */

const ALLOWED = ['https://twenty-questions-swart.vercel.app'];

describe('Origin 检查:三条', () => {
  it('**伪 Origin(别人的网站)→ 拒**', () => {
    expect(checkOrigin('https://evil.example.com', ALLOWED, true)).toEqual({
      allowed: false,
      reason: 'mismatch',
    });
  });

  it('**正确 Origin → 过**', () => {
    expect(checkOrigin('https://twenty-questions-swart.vercel.app', ALLOWED, true)).toEqual({
      allowed: true,
      reason: 'match',
    });
  });

  /**
   * **无 Origin(脚本)→ 放行。这是有意的,不是漏网。**
   *
   * 浏览器永远发 Origin,所以「别人的网站」一定带着真实 Origin,挡得住。
   * 而脚本本来就能随便写 Origin —— 拒绝空 Origin 只会挡住我们自己的 smoke 脚本
   * 和健康探针,一点真实保护都换不到。**假的安全感比没有更糟。**
   */
  it('**无 Origin(curl / node 脚本)→ 放行**,并且我们知道自己在放行什么', () => {
    expect(checkOrigin(undefined, ALLOWED, true)).toEqual({
      allowed: true,
      reason: 'no-origin',
    });
    expect(checkOrigin('', ALLOWED, true)).toEqual({ allowed: true, reason: 'no-origin' });
  });

  it('dev(不启用)时一律放行,连伪 Origin 也放', () => {
    expect(checkOrigin('https://evil.example.com', ALLOWED, false)).toEqual({
      allowed: true,
      reason: 'not-enforced',
    });
  });

  it('末尾斜杠不影响判定 —— 和 CLIENT_ORIGIN 的归一化保持一致', () => {
    expect(
      checkOrigin('https://twenty-questions-swart.vercel.app/', ALLOWED, true).allowed,
    ).toBe(true);
  });

  it('多值 CLIENT_ORIGIN:任一命中即可', () => {
    const multi = ['https://prod.example', 'http://localhost:5173'];
    expect(checkOrigin('http://localhost:5173', multi, true).allowed).toBe(true);
    expect(checkOrigin('https://prod.example', multi, true).allowed).toBe(true);
    expect(checkOrigin('https://other.example', multi, true).allowed).toBe(false);
  });

  it('子域 / 前缀不算命中 —— 精确匹配', () => {
    expect(checkOrigin('https://evil.twenty-questions-swart.vercel.app', ALLOWED, true).allowed).toBe(false);
    expect(checkOrigin('https://twenty-questions-swart.vercel.app.evil.com', ALLOWED, true).allowed).toBe(false);
  });
});

/* ═══════════════════════ 客户端 IP ═══════════════════════ */

describe('客户端 IP:必须读 X-Forwarded-For', () => {
  it('**有 XFF 时用它** —— Caddy 后面所有连接的 address 都是同一个网关', () => {
    expect(
      clientIpOf({ address: '172.18.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } }),
    ).toBe('203.0.113.9');
  });

  it('XFF 有多段时取第一段(最靠近客户端的)', () => {
    expect(
      clientIpOf({ address: '172.18.0.1', headers: { 'x-forwarded-for': '203.0.113.9, 172.18.0.1' } }),
    ).toBe('203.0.113.9');
  });

  it('没有 XFF 就退回 handshake.address(本地开发)', () => {
    expect(clientIpOf({ address: '127.0.0.1', headers: {} })).toBe('127.0.0.1');
  });

  it('什么都没有也不会返回 undefined', () => {
    expect(clientIpOf({})).toBe('unknown');
  });

  it('⚠️ 若这里退化成只看 address,Caddy 后面所有人会共用一个计数', () => {
    // 这条断言是护栏的护栏:它一旦失败,per-IP 上限就变成了 per-房间上限
    const a = clientIpOf({ address: '172.18.0.1', headers: { 'x-forwarded-for': '1.1.1.1' } });
    const b = clientIpOf({ address: '172.18.0.1', headers: { 'x-forwarded-for': '2.2.2.2' } });
    expect(a).not.toBe(b);
  });
});

/* ═══════════════════════ per-IP 并发连接 ═══════════════════════ */

describe('per-IP 并发连接上限', () => {
  it('到上限之前都放行', () => {
    const c = new ConnectionCounter(3);
    expect(c.tryAdd('1.1.1.1')).toBe(true);
    expect(c.tryAdd('1.1.1.1')).toBe(true);
    expect(c.tryAdd('1.1.1.1')).toBe(true);
    expect(c.countFor('1.1.1.1')).toBe(3);
  });

  it('**超限拒新连接**', () => {
    const c = new ConnectionCounter(2);
    c.tryAdd('1.1.1.1');
    c.tryAdd('1.1.1.1');
    expect(c.tryAdd('1.1.1.1')).toBe(false);
    expect(c.countFor('1.1.1.1')).toBe(2); // 被拒的那条没有占名额
  });

  it('**按 IP 分开算** —— 一个人连爆了不影响别人', () => {
    const c = new ConnectionCounter(1);
    expect(c.tryAdd('1.1.1.1')).toBe(true);
    expect(c.tryAdd('1.1.1.1')).toBe(false);
    expect(c.tryAdd('2.2.2.2')).toBe(true); // 另一个 IP 照常
  });

  it('断开之后名额还回来', () => {
    const c = new ConnectionCounter(1);
    c.tryAdd('1.1.1.1');
    expect(c.tryAdd('1.1.1.1')).toBe(false);
    c.release('1.1.1.1');
    expect(c.tryAdd('1.1.1.1')).toBe(true);
  });

  it('**归零的 IP 从表里删掉** —— 否则 Map 会随着来往的 IP 无限长大', () => {
    const c = new ConnectionCounter(5);
    c.tryAdd('1.1.1.1');
    c.release('1.1.1.1');
    expect(c.trackedIps()).toBe(0);
  });

  it('多放几次也不会变成负数', () => {
    const c = new ConnectionCounter(5);
    c.release('1.1.1.1');
    c.release('1.1.1.1');
    expect(c.countFor('1.1.1.1')).toBe(0);
    expect(c.tryAdd('1.1.1.1')).toBe(true);
  });

  it('默认 20 对朋友局绰绰有余(一个人开几个标签页也够)', () => {
    const c = new ConnectionCounter(guardrailsFromEnv({}).maxConnectionsPerIp);
    for (let i = 0; i < 20; i++) expect(c.tryAdd('1.1.1.1')).toBe(true);
    expect(c.tryAdd('1.1.1.1')).toBe(false);
  });
});

/* ═══════════════════════ 令牌桶 ═══════════════════════ */

describe('令牌桶:时间外部传入,测试不用真等', () => {
  it('容量之内连着来都放行', () => {
    const b = new TokenBucket(10, 20, 0);
    for (let i = 0; i < 20; i++) expect(b.tryTake(0)).toBe(true);
  });

  it('**超出容量就拒**', () => {
    const b = new TokenBucket(10, 5, 0);
    for (let i = 0; i < 5; i++) b.tryTake(0);
    expect(b.tryTake(0)).toBe(false);
  });

  it('按速率回填 —— 等一秒回 10 个', () => {
    const b = new TokenBucket(10, 20, 0);
    for (let i = 0; i < 20; i++) b.tryTake(0);
    expect(b.tryTake(0)).toBe(false);

    expect(b.tryTake(1000)).toBe(true); // 一秒后回了 10 个
    expect(b.available(1000)).toBeCloseTo(9, 5);
  });

  it('回填不会超过容量', () => {
    const b = new TokenBucket(10, 20, 0);
    b.tryTake(0);
    expect(b.available(60_000)).toBe(20); // 等一分钟也只到容量
  });

  it('时间倒流不会凭空发牌', () => {
    const b = new TokenBucket(10, 20, 1000);
    for (let i = 0; i < 20; i++) b.tryTake(1000);
    expect(b.tryTake(0)).toBe(false);
  });

  it('判定桶比普通桶宽 —— oracle 清队列会连点', () => {
    const c = guardrailsFromEnv({});
    expect(c.judgeRatePerSec).toBeGreaterThan(c.eventRatePerSec);
  });

  it('判定类事件走判定桶', () => {
    expect(isJudgeEvent('c:judge')).toBe(true);
    expect(isJudgeEvent('c:correct_last')).toBe(true);
    expect(isJudgeEvent('c:resolve_submission')).toBe(true);
    expect(isJudgeEvent('c:ask_question')).toBe(false);
    expect(isJudgeEvent('c:hello')).toBe(false);
  });

  it('**默认配置下,正常玩不会被限速**', () => {
    // 一个 guesser 最激烈的用法:连着敲问题。默认 10/s + 容量 20,
    // 人手根本达不到 —— 这道闸是给脚本准备的。
    const c = guardrailsFromEnv({});
    const b = new TokenBucket(c.eventRatePerSec, c.burst, 0);
    let t = 0;
    let blocked = 0;
    for (let i = 0; i < 60; i++) {
      t += 300; // 每 300ms 一个动作 ≈ 人类连点的上限
      if (!b.tryTake(t)) blocked++;
    }
    expect(blocked).toBe(0);
  });
});
