/**
 * 题库模块(SPEC §6)+ 20Q 的随机建议词表。
 *
 * ⚠️ **这是两样东西,不是一样。** 题库是海龟汤的题目集合(`hasBank: true`);
 * 建议词表是 20Q 给 oracle 的灵感提示,不是题库,永远别把它们合并成一个模块。
 *
 * 防剧透三件套在这里落两件:
 *   1. 列表投影只出 title + tags/difficulty(`toListItem`,whitelist)。
 *   2. per-room 已用 Set 过滤 —— 同房不重复出现在列表里。
 * 第三件(确认选定后才展开汤底)在 Room 的 `toClientState` 里,不在这。
 *
 * **零持久化(ADR-12):** 已用 Set 活在 Room 实例上,房间没了就没了。
 * 跨 session 追踪是 auth 时代的功能,v1 不做。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toListItem, type PuzzleListItem, type SituationPuzzle } from '@shared/puzzles';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DATA = path.join(DATA_DIR, 'puzzles.zh.json');
const WORDS = path.join(DATA_DIR, 'answer-words.zh.json');

function load(): SituationPuzzle[] {
  const raw: unknown = JSON.parse(readFileSync(DATA, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('puzzles.zh.json: expected an array');

  const seen = new Set<string>();
  return raw.map((p, i) => {
    const q = p as Partial<SituationPuzzle>;
    if (!q.id || !q.title || !q.surface || !q.truth) {
      throw new Error(`puzzles.zh.json[${i}]: id / title / surface / truth are all required`);
    }
    if (seen.has(q.id)) throw new Error(`puzzles.zh.json: duplicate id "${q.id}"`);
    seen.add(q.id);
    return q as SituationPuzzle;
  });
}

/** 进程启动时读一次。题库是只读的,改 json 要重启 —— v1 接受。 */
const PUZZLES: readonly SituationPuzzle[] = load();

const BY_ID = new Map(PUZZLES.map((p) => [p.id, p]));

export function bankSize(): number {
  return PUZZLES.length;
}

/** 完整题目 —— **只有 Room 内部能拿**,永不直接进 payload。 */
export function findPuzzle(id: string): SituationPuzzle | undefined {
  return BY_ID.get(id);
}

/**
 * 给 oracle 的选题列表。
 * 已用的**不出现**(不是置灰,是不出现)—— 同房不重复。
 */
export function listAvailable(used: ReadonlySet<string>): PuzzleListItem[] {
  return PUZZLES.filter((p) => !used.has(p.id)).map(toListItem);
}

/** 题库被这一房用光了没。用光时 client 该引导去自写。 */
export function isExhausted(used: ReadonlySet<string>): boolean {
  return listAvailable(used).length === 0;
}

/* ────────────────────── 20Q 随机建议词表 ──────────────────────
 * **不是题库。** 20Q 的 oracle 自己想答案词;这只是「想不出来时点一下」的提示。
 * 刻意保持短小、具体、可被是非问题收敛。
 *
 * 和题库一样住在 `data/` 而不是这里 —— **内容进 data,代码进 src**。
 * 这条分工让「server/src 的 .ts 里零中文字面量」成为一条可自动检查的纪律
 * (discipline.test.ts),而不是靠自觉。
 */
const SUGGESTIONS: readonly string[] = loadWords();

function loadWords(): string[] {
  const raw: unknown = JSON.parse(readFileSync(WORDS, 'utf8'));
  if (!Array.isArray(raw) || raw.some((w) => typeof w !== 'string' || !w)) {
    throw new Error('answer-words.zh.json: expected a non-empty array of strings');
  }
  return raw as string[];
}

/** 随机给一个建议词;`exclude` 用来避免「再来一个」时抽到同一个。 */
export function suggestAnswerWord(exclude?: string): string {
  for (let i = 0; i < 20; i++) {
    const w = SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)]!;
    if (w !== exclude) return w;
  }
  return SUGGESTIONS[0]!;
}

export function suggestionCount(): number {
  return SUGGESTIONS.length;
}
