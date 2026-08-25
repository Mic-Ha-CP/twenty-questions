/**
 * 进程入口。Express + Socket.io,tsx 直跑(无编译产物)。
 *
 * 部署形态见 `platform-docs/VPS-DEPLOY.md`:pm2 → npm start → tsx,前面挡一层 Caddy。
 * 逐条执行的步骤在 `docs/DEPLOY-RUN.md`。
 *
 * 这个文件里和部署直接相关的三件事:
 *   · **没有 dotenv**(配方 gotcha 1)—— env 由 pm2 的 ecosystem 注入,
 *     `.env` 文件在 VPS 上不会被读。
 *   · `CLIENT_ORIGIN` 是 CORS 白名单。配方 gotcha 3 说它是单值精确匹配;
 *     本 repo **接受逗号分隔的多值**(见下),这是相对配方的一处有意偏差。
 *   · `/health` 返回的东西要够回答「配置对不对」,否则每次排查都得 ssh 上去翻 pm2 日志。
 */

import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { GAME_META } from '@shared/meta';
import { guardrailsFromEnv } from './net/guardrails';
import { attachSocketLayer } from './socket/index';

const PORT = Number(process.env.PORT ?? 3002);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * 允许的前端 origin。
 *
 * 跨 repo 的 URL **只能**来自 env(CONVENTIONS.md:源码里永不写死别的 repo 的地址)。
 *
 * **末尾斜杠会让整个游戏连不上**(配方 gotcha 3:`cors` 做的是字符串精确比较,
 * `https://x.app/` 匹配不上浏览器发来的 `https://x.app`)。与其让一个手滑
 * 变成一次全站故障,这里**主动去掉末尾斜杠并大声记一条日志** ——
 * 修掉症状,但不掩盖原因。
 */
function parseOrigins(raw: string): { origins: string[]; normalised: string[] } {
  const normalised: string[] = [];
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((o) => {
      const clean = o.replace(/\/+$/, '');
      if (clean !== o) normalised.push(o);
      return clean;
    });
  return { origins, normalised };
}

const rawOrigin = process.env.CLIENT_ORIGIN ?? '';

/**
 * **生产环境必须显式给 CLIENT_ORIGIN。**
 *
 * 不给就默认 localhost 的话,线上表现是「页面能开,但所有人都连不上」,
 * 而且浏览器只会报一句 CORS —— 这种失败方式最费时间。宁可开不起来。
 */
if (IS_PRODUCTION && !rawOrigin) {
  console.error(
    `[${GAME_META.gameId}] FATAL: NODE_ENV=production but CLIENT_ORIGIN is unset. ` +
      `Set it in the pm2 ecosystem file (there is no dotenv — see VPS-DEPLOY gotcha 1).`,
  );
  process.exit(1);
}

const { origins: CLIENT_ORIGIN, normalised } = parseOrigins(rawOrigin || 'http://localhost:5173');

const LIMITS = guardrailsFromEnv();

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN },
  /**
   * 默认 1MB 压到 64KB。最大的合法 payload 是一段还原叙述(600 字),
   * 离 64KB 远得很 —— 剩下的空间只对想塞垃圾的人有用。
   */
  maxHttpBufferSize: LIMITS.maxPayloadBytes,
});

/**
 * ⚠️ **Origin 检查只在生产启用。**
 * dev 里不启用:本地会用各种 origin 试(dev server、局域网 IP、smoke 脚本),
 * 全挡掉只会挡住自己。
 *
 * 另外它**不是访问控制** —— 浏览器伪造不了 Origin,所以挡得住「别人的网站」;
 * 脚本想写什么写什么,挡不住,而且没有应用层办法挡得住。详见 net/guardrails.ts。
 */
const socketLayer = attachSocketLayer(io, {
  allowedOrigins: CLIENT_ORIGIN,
  enforceOrigin: IS_PRODUCTION,
  guardrails: LIMITS,
});

/**
 * 健康检查。配方全程拿它当探针,所以形状要稳:**`ok` 永远在,永远是布尔**。
 *
 * 额外带上 `port` 与 `allowedOrigins`,是为了让「CORS 配错了吗」这个问题
 * 一条 curl 就能回答 —— 不必 ssh 上去翻 pm2 日志。
 * 这些都不是秘密:origin 本来就烤进了前端 bundle(VITE_* 从来不是 secret)。
 */
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    game: GAME_META.gameId,
    rooms: socketLayer.manager.size(),
    uptimeSec: Math.round(process.uptime()),
    port: PORT,
    allowedOrigins: CLIENT_ORIGIN,
  });
});

server.listen(PORT, () => {
  console.log(`[${GAME_META.gameId}] listening on :${PORT}`);
  console.log(`[${GAME_META.gameId}] CLIENT_ORIGIN=${CLIENT_ORIGIN.join(',')}`);
  if (normalised.length > 0) {
    // 不静默修好就算了 —— 让它在 pm2 日志里留一行,免得同样的手滑再来一次
    console.warn(
      `[${GAME_META.gameId}] WARN: stripped trailing slash from ${normalised.join(', ')} ` +
        `— a trailing slash in CLIENT_ORIGIN blocks every browser (VPS-DEPLOY gotcha 3).`,
    );
  }
  if (!IS_PRODUCTION && !rawOrigin) {
    console.log(`[${GAME_META.gameId}] (dev default origin; set CLIENT_ORIGIN for anything else)`);
  }
  // 把生效中的护栏打出来 —— 线上调阈值时能一眼确认改到没有
  console.log(
    `[${GAME_META.gameId}] guardrails: originCheck=${IS_PRODUCTION ? 'on' : 'off (dev)'} ` +
      `maxConnPerIp=${LIMITS.maxConnectionsPerIp} ` +
      `rate=${LIMITS.eventRatePerSec}/s (judge ${LIMITS.judgeRatePerSec}/s, burst ${LIMITS.burst}) ` +
      `maxPayload=${LIMITS.maxPayloadBytes}B`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    socketLayer.dispose();
    io.close();
    server.close(() => process.exit(0));
  });
}
