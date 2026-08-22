/**
 * ⚠️ ─────────────────────────────────────────────────────────────────────────
 *  临时件 · ADR-10 · **删,不是重构。**
 *
 *  这个文件和 `client/src/lib/nickname.ts` 是平台身份(ADR-3 / ADR-9)落地前的
 *  **临时托管**。平台身份一到,identity 随 player 一起到达,首屏塌缩成纯 lobby,
 *  这两个文件**整块删掉** —— 出口是一次删除,不是一次解耦。
 *
 *  维持这一点的唯一不变量:**display name 是纯展示,identity 永远是 playerId。**
 *  正因如此,重名才能在 server 端安全重摇。
 *
 *  纪律:不许有别的模块 import 这里的东西去做「身份」相关的判断。
 *  只有 nickname 生成/重摇这一条路径可以碰它。
 * ───────────────────────────────────────────────────────────────────────── ⚠️
 */

/**
 * 偏差记录:LOBBY-PATTERN.md 登记的形状是 `[adjective] [noun]` 英文词表。
 * 本 repo **形状照抄,内容不照抄** —— UI 中文优先(SPEC §0),所以是 zh 词表,
 * 且不加空格(中文里空格是噪音)。详见 NOTES 偏差 log。
 */
const ADJECTIVES = [
  '沉默', '多疑', '冷静', '健忘', '疲惫', '好奇', '孤僻', '敏锐',
  '迟到', '匿名', '失眠', '固执', '温和', '狡黠', '走神', '不安',
  '守时', '过路', '爱笑', '寡言', '眼尖', '倒霉', '装睡', '早到',
] as const;

const NOUNS = [
  '侦探', '证人', '房客', '记者', '船长', '医生', '邻居', '旅人',
  '钟表匠', '守夜人', '图书管理员', '调酒师', '园丁', '摄影师',
  '收音机', '猫', '影子', '来电', '乘客', '面包师',
] as const;

/** 词表容量;够大就不用担心一房撞名,撞了也有 server 端重摇兜底。 */
export const NAME_SPACE_SIZE = ADJECTIVES.length * NOUNS.length;

function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}

/** 生成一个访客显示名,如「沉默的侦探」。 */
export function generateGuestName(): string {
  return `${pick(ADJECTIVES)}的${pick(NOUNS)}`;
}

/**
 * 在房内重摇一个不与 `taken` 冲突的名字。
 * 房间层在 join 时调用 —— 这就是「重名 server 端重摇」的实现点。
 * 兜底:词表撞完了就挂个序号,永不无限循环。
 */
export function rerollUniqueName(taken: Iterable<string>, seed?: string): string {
  const used = new Set(taken);
  if (seed && !used.has(seed)) return seed;

  for (let i = 0; i < 40; i++) {
    const candidate = generateGuestName();
    if (!used.has(candidate)) return candidate;
  }
  const base = seed ?? generateGuestName();
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 显示名的合法性:非空、去空白后 1–16 字。**这不是身份校验。** */
export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > 16) return null;
  return trimmed;
}
