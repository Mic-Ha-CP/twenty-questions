/**
 * pm2 启动配置的**模板**。
 *
 * VPS 上不要直接用这个文件 —— 先拷一份:
 *     cp ecosystem.config.example.cjs ecosystem.config.cjs
 * 拷出来的 `ecosystem.config.cjs` 是 gitignored 的,因为 cutover 时要就地改
 * `CLIENT_ORIGIN`;进了 git 的话每次 `git pull` 都得处理冲突。
 *
 * **文件名必须是 `.cjs`** —— `server/package.json` 里有 `"type": "module"`,
 * 叫 `.js` 的话 pm2 会按 ESM 解析然后崩在 `module is not defined`
 * (VPS-DEPLOY gotcha 5)。
 *
 * **env 只能写在这里** —— server 不加载 `.env`,VPS 上没有 dotenv
 * (gotcha 1)。改了这里的 env 之后**不能 `pm2 restart`**,pm2 会缓存旧 env;
 * 必须 `pm2 delete` 再 `pm2 start`。
 *
 * 逐条执行步骤见 `docs/DEPLOY-RUN.md`。
 */

module.exports = {
  apps: [
    {
      name: 'twenty-questions-server',
      cwd: '/opt/twenty-questions/server',

      // 形态锁死:pm2 → npm start → tsx 直跑,不出编译产物(stack 锁定,DECISIONS #2)
      script: 'npm',
      args: 'start',

      env: {
        NODE_ENV: 'production',

        /**
         * ⚠️ **上线前先核实这个端口没被占。**
         * 这台机器不是空的:codebreaker 和 ocgen 已经在上面。
         * runbook 的「Stage 1 · 端口决策」一步会让你先跑 `ss -tlnp` 再定。
         * 改这里之后,Caddy site 块里的端口要一起改。
         */
        PORT: '3002',

        /**
         * **bring-up 阶段的值** —— 此时的测试客户端是本地 dev client(gotcha 3)。
         * **cutover 时改成 Vercel 生产域**,例如 https://twenty-questions.vercel.app
         * (末尾**不要**斜杠;server 会替你去掉并警告,但别依赖它)。
         *
         * 本 repo 接受逗号分隔的多值 —— 这是相对配方的有意偏差,
         * 想同时放行「生产域 + 某个固定 preview 域」时用得上。
         */
        CLIENT_ORIGIN: 'http://localhost:5173',

        /*
         * ── 滥用兜底三件套(可选,不写就用代码里的默认值)──
         *
         * 定位是**随机扫描器保险,不是抗定向攻击**。真被定向打了,
         * 答案是 Cloudflare 免费档前置 + 封 IP,不在应用层解。
         *
         * 默认值对朋友局绰绰有余,一般不用动。要调就在这里加,
         * 改完记得 pm2 delete + start(不是 restart —— pm2 缓存 env)。
         *
         *   MAX_CONNECTIONS_PER_IP: '20',   // 同一 IP 并发连接上限
         *   EVENT_RATE_PER_SEC:     '10',   // 普通事件速率
         *   JUDGE_RATE_PER_SEC:     '30',   // 判定类放宽(oracle 清队列会连点)
         *   EVENT_BURST:            '20',   // 桶容量(允许的突发)
         *   MAX_PAYLOAD_BYTES:      '65536',// socket.io 单帧上限(默认 1MB → 64KB)
         */
      },
    },
  ],
};
