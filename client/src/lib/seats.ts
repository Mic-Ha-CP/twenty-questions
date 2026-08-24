/**
 * 玩家身份三件套的纯逻辑部分:**固定颜色点**与**真相面板的渲染判定**。
 *
 * 三件套(session 5 smoke 带回):
 *   1. 自己的名字全 UI 带「你」标记;
 *   2. 入房序号(server 侧 `Player.seatNo`,不回收);
 *   3. **每人一个固定颜色点** —— 由序号派生,所以每个 client 算出来都一样,
 *      不需要 server 再发一个字段。玩家列表与 Q&A 流用同一个颜色。
 *
 * 为什么要:访客名是随机生成的,一屋子「早到的钟表匠」和「早到的收音机」
 * 光看名字认不出谁是谁。颜色点 + 序号给每个人一个**跨屏一致**的锚。
 */

/**
 * 座位色盘 —— **中性,禁琥珀**。
 *
 * 两条避让,都是为了不和已有语义打架:
 *   · 避开琥珀(hue ≈ 74)—— 那是三焦点专用(汤面/额度/命中,DECISIONS #6);
 *   · 避开判定绿(hue ≈ 150)与判定红(hue ≈ 25)—— 座位色不该被读成判定。
 * 剩下的可用弧段大约是 170–350,在里面均匀取 8 个。
 * 彩度压在 0.075 左右:是「墨点」不是霓虹,别抢 1c 暗房的调子。
 */
const SEAT_HUES = [175, 200, 225, 250, 275, 300, 325, 345] as const;

/** 超过 8 人时换一档明度继续排,仍然唯一可辨。 */
const SEAT_LIGHTNESS = [0.74, 0.62] as const;

/**
 * 由座位号算颜色。**纯函数、确定性** —— 同一个号在任何人的屏幕上都是同一个色。
 * `seatNo` 从 1 开始;传 0 或负数也不会崩(取模兜底)。
 */
export function seatColor(seatNo: number): string {
  const i = Math.max(0, Math.trunc(seatNo) - 1);
  const hue = SEAT_HUES[i % SEAT_HUES.length]!;
  const l = SEAT_LIGHTNESS[Math.floor(i / SEAT_HUES.length) % SEAT_LIGHTNESS.length]!;
  return `oklch(${l} 0.075 ${hue})`;
}

/** 圈号字形:①②③… 超出范围就退回普通数字,不留空。 */
export function seatBadge(seatNo: number): string {
  const n = Math.trunc(seatNo);
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  return `#${n}`;
}

/* ─────────────────── 真相面板的渲染判定 ─────────────────── */

/**
 * 只在 oracle 的投影里存在的东西 —— 有没有可渲染的真相。
 *
 * 这是 session 5 smoke 带回的第一件修正:oracle 在 playing 里需要一个**常驻**的
 * 汤底/答案词面板。两个理由:
 *   · **中途接管者靠它接得住**(SPEC §7:真相在系统里,游戏不死);
 *   · 原 oracle 判到后段也会忘,尤其海龟汤的汤底很长。
 *
 * 结构性缺席纪律不变:`oracleTruth` 本来就只在 oracle 那一份 RoomState 里非 null,
 * 所以这个判定**天然是安全的** —— guesser 拿不到值,也就渲染不出面板。
 */
export interface TruthPanelSource {
  oracleId: string | null;
  viewerId: string;
  oracleTruth: string | null;
}

export function shouldShowTruthPanel(room: TruthPanelSource): boolean {
  return room.oracleId === room.viewerId && !!room.oracleTruth;
}

/* ─────────────────── 转移出题人入口的显隐 ─────────────────── */

/**
 * 中段转移入口要不要出现。
 *
 * **判定依据是 server 投影里的 `canTransferOracle`,不是 client 自己数人头** ——
 * 两边各写一份人数规则,迟早会漂(server 那条在 `Room.canTransferOracle`)。
 * 2 人房中段:整块隐藏,只剩「公开汤底 · 结束本局」那条出路。
 */
export interface TransferControlSource {
  isHost: boolean;
  canTransferOracle: boolean;
}

export function shouldShowTransferControl({
  isHost,
  canTransferOracle,
}: TransferControlSource): boolean {
  return isHost && canTransferOracle;
}
