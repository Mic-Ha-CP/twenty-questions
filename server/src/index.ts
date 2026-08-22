/**
 * 进程入口。Express + Socket.io,tsx 直跑(无编译产物)。
 *
 * 部署形态见 platform-docs/VPS-DEPLOY.md(pm2 + Caddy)—— **Phase 3 才做**,
 * 本文件此刻只需要在本地起得来、健康检查是绿的。
 */

import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { GAME_META } from '@shared/meta';
import { attachSocketLayer } from './socket/index';

const PORT = Number(process.env.PORT ?? 3002);

/**
 * 跨 repo 的 URL **只能**来自 env(CONVENTIONS.md:源码里永不写死别的 repo 的地址)。
 * 逗号分隔多个 origin;不设则开发期放行 localhost。
 */
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    game: GAME_META.gameId,
    rooms: socketLayer.manager.size(),
    uptimeSec: Math.round(process.uptime()),
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN },
});

const socketLayer = attachSocketLayer(io);

server.listen(PORT, () => {
  console.log(`[${GAME_META.gameId}] listening on :${PORT}`);
  console.log(`[${GAME_META.gameId}] CLIENT_ORIGIN=${CLIENT_ORIGIN.join(',')}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    socketLayer.dispose();
    io.close();
    server.close(() => process.exit(0));
  });
}
