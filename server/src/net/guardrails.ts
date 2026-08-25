/**
 * 网络层护栏 —— Origin 检查 + 滥用兜底三件套。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 定位:**随机扫描器保险,不是抗定向攻击。**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 这里挡得住的:别人的网站借用我们的后端、互联网上的随机扫描、手抖点太快、
 * 有人往 socket 里塞一坨巨大的 payload。
 *
 * 这里**挡不住**的:任何非浏览器客户端(curl / node / 自制 client)。
 * 它们想写什么 `Origin` 就写什么,想换 IP 就换 IP。**没有应用层办法能挡住它们。**
 * 真被定向打了,答案是 Cloudflare 免费档前置 + 封 IP,不在这一层解。
 *
 * 为什么 Origin 检查仍然值得做:**浏览器不能伪造 `Origin`。**
 * evil.com 上的页面连过来,`Origin` 一定是 `https://evil.com`。
 * 所以「别人做个前端指向我们后端」这个具体场景,这里是真挡得住的。
 *
 * ⚠️ 和 CORS 不是一回事:CORS 是**浏览器**执行的(server 只是少发个响应头,
 * 请求照样处理);这里是 **server 主动拒绝连接**。详见 `docs/HANDOFF-V1.md` §1.8。
 */

/** 阈值全部走 env,方便线上不改代码就调。 */
export interface GuardrailConfig {
  /** 同一 IP 的并发连接上限。超了拒新连接。 */
  maxConnectionsPerIp: number;
  /** 普通事件的令牌桶速率(个/秒)。 */
  eventRatePerSec: number;
  /** 判定类操作的令牌桶速率 —— oracle 清队列时会连点,放宽。 */
  judgeRatePerSec: number;
  /** 桶容量(允许的突发量)。 */
  burst: number;
  /** socket.io 单帧上限(字节)。 */
  maxPayloadBytes: number;
}

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
};

export function guardrailsFromEnv(env: NodeJS.ProcessEnv = process.env): GuardrailConfig {
  return {
    maxConnectionsPerIp: num(env.MAX_CONNECTIONS_PER_IP, 20),
    eventRatePerSec: num(env.EVENT_RATE_PER_SEC, 10),
    judgeRatePerSec: num(env.JUDGE_RATE_PER_SEC, 30),
    burst: num(env.EVENT_BURST, 20),
    /**
     * 默认 1MB 压到 64KB。最大的合法 payload 是一段还原叙述
     * (`JUDGING_LIMITS.submissionMax` = 600 字),离 64KB 都远得很。
     */
    maxPayloadBytes: num(env.MAX_PAYLOAD_BYTES, 64 * 1024),
  };
}

/* ═══════════════════════ Origin 检查 ═══════════════════════ */

export type OriginVerdict =
  | { allowed: true; reason: 'not-enforced' | 'match' | 'no-origin' }
  | { allowed: false; reason: 'mismatch' };

/**
 * 握手时的 Origin 判定。
 *
 * **没有 `Origin` 的一律放行**,这是有意的:
 *   · 浏览器**永远**会发 `Origin`,所以「别人的网站」这个场景一定带着真实 Origin,挡得住;
 *   · 脚本本来就能随便写 Origin,拒绝空 Origin 只会挡住我们自己的 smoke 脚本
 *     和健康探针,却给不了任何真实保护 —— 那是**假的安全感**。
 * 换句话说:这道门是给浏览器用的,对脚本从来就不设防,而且我们知道这一点。
 */
export function checkOrigin(
  origin: string | undefined,
  allowed: readonly string[],
  enforce: boolean,
): OriginVerdict {
  if (!enforce) return { allowed: true, reason: 'not-enforced' };
  if (!origin) return { allowed: true, reason: 'no-origin' };
  // 和 CLIENT_ORIGIN 一样按去掉末尾斜杠之后比较
  const clean = origin.replace(/\/+$/, '');
  return allowed.includes(clean)
    ? { allowed: true, reason: 'match' }
    : { allowed: false, reason: 'mismatch' };
}

/* ═══════════════════════ 客户端 IP ═══════════════════════ */

/**
 * 取真实客户端 IP。
 *
 * ⚠️ **不能直接用 `handshake.address`** —— 我们跑在 Caddy 后面,
 * 所有连接看起来都来自同一个网关(172.18.0.1)。照那个计数的话,
 * per-IP 上限会变成 per-房间上限,20 个人就把整个游戏卡死。
 *
 * 所以读 `X-Forwarded-For` 的**第一段**(最靠近客户端的那个)。
 * 这个头是可以伪造的,但我们的端口只对 compose 网段开放(ufw),
 * 唯一能到达的路径就是 Caddy —— 而 Caddy 会覆写这个头。
 */
export function clientIpOf(handshake: {
  address?: string;
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const xff = handshake.headers?.['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  const first = raw?.split(',')[0]?.trim();
  return first || handshake.address || 'unknown';
}

/* ═══════════════════════ per-IP 并发连接数 ═══════════════════════ */

export class ConnectionCounter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit: number) {}

  /** 试着占一个名额。返回 false = 超限,该拒绝这条连接。 */
  tryAdd(ip: string): boolean {
    const current = this.counts.get(ip) ?? 0;
    if (current >= this.limit) return false;
    this.counts.set(ip, current + 1);
    return true;
  }

  release(ip: string): void {
    const current = this.counts.get(ip) ?? 0;
    // 归零就删掉 key,别让 Map 随着来来往往的 IP 无限长大
    if (current <= 1) this.counts.delete(ip);
    else this.counts.set(ip, current - 1);
  }

  countFor(ip: string): number {
    return this.counts.get(ip) ?? 0;
  }

  /** 正在被追踪的 IP 数 —— 用来确认没有泄漏。 */
  trackedIps(): number {
    return this.counts.size;
  }
}

/* ═══════════════════════ 令牌桶 ═══════════════════════ */

/**
 * 简单令牌桶。**时间由外部传入**,所以测试不需要真的等。
 *
 * 超限的处理是**丢掉这一条事件 + 回一个错误码**,不是断开连接 ——
 * 手抖点快了不该把人踢下线。
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly capacity: number,
    now = 0,
  ) {
    this.tokens = capacity;
    this.lastRefill = now;
  }

  tryTake(now: number, cost = 1): boolean {
    this.refill(now);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  private refill(now: number): void {
    const elapsedSec = Math.max(0, (now - this.lastRefill) / 1000);
    if (elapsedSec === 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.ratePerSec);
    this.lastRefill = now;
  }

  /** 测试/诊断用。 */
  available(now: number): number {
    this.refill(now);
    return this.tokens;
  }
}

/**
 * 哪些事件走「判定桶」(更宽松的那个)。
 * oracle 清一串队列时会连点,不该被普通速率挡住。
 */
export const JUDGE_EVENTS: readonly string[] = [
  'c:judge',
  'c:correct_last',
  'c:resolve_submission',
];

export function isJudgeEvent(event: string): boolean {
  return JUDGE_EVENTS.includes(event);
}
