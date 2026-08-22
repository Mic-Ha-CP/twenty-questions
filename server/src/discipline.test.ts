/**
 * 结构测试 —— 钉住那些「靠自觉维持、坏了没人发现」的纪律。
 *
 * PROJECT_RIGOR §4 必测 6(config 表分流 + 搜不到 `puzzleType ===`)与
 * 必测 10(i18n:server 不发展示字符串)。
 *
 * 这类测试不测行为,测的是**代码长什么样**。它们存在的理由:纪律一旦破,
 * 功能照跑,只是三个月后没人记得为什么加第三个 puzzle type 要改二十处。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PUZZLE_TYPES, PUZZLE_TYPE_IDS, puzzleConfig } from '@shared/puzzleTypes';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = HERE;
const SHARED = path.resolve(HERE, '../../shared');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    if (!name.endsWith('.ts')) return [];
    if (name.endsWith('.test.ts')) return [];
    return [full];
  });
}

/** 去掉注释,只留真正会执行的代码 —— 注释里写「禁止 xxx」不该把自己判成违规。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * 「拿 puzzleType 和某个具体类型比」= 绕开 config 表的分叉,禁止。
 *
 * 放行 `!== undefined` / `!= null`:那是「调用方有没有传这个字段」的**存在性检查**
 * (settings patch 就得这么写),与类型无关。
 *
 * 故意把右操作数**抓出来再判**,不用 `(?!undefined)` 这类前瞻 ——
 * 前瞻会因为 `\s*` 回溯成零宽而失效(第一版就是这么写错的)。
 */
function hasTypeBranch(code: string): boolean {
  if (/switch\s*\(\s*[\w.]*[Pp]uzzleType\s*\)/.test(code)) return true;

  const cmp = /[\w.]*\bpuzzleType\s*[!=]==?\s*([^\s;)&|]+)/g;
  for (const m of code.matchAll(cmp)) {
    const rhs = m[1]!;
    if (rhs !== 'undefined' && rhs !== 'null') return true;
  }
  return false;
}

describe('config 表是唯一分流点(必测 6)', () => {
  const files = [...tsFiles(SERVER_SRC), ...tsFiles(SHARED)];

  it('扫到的源文件不为空(免得断言在空集合上假绿)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('**server 逻辑里搜不到 `puzzleType === <某个类型>` 这样的类型分支**', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'));
      if (hasTypeBranch(code)) offenders.push(path.relative(SERVER_SRC, f));
    }
    expect(offenders).toEqual([]);
  });

  it('这条扫描确实抓得住违规写法(免得正则写歪了假绿)', () => {
    expect(hasTypeBranch("if (puzzleType === 'situation') {")).toBe(true);
    expect(hasTypeBranch('if (room.puzzleType !== SITUATION) {')).toBe(true);
    expect(hasTypeBranch('switch (room.puzzleType) {')).toBe(true);
    // 存在性检查放行
    expect(hasTypeBranch('if (patch.puzzleType !== undefined) {')).toBe(false);
    expect(hasTypeBranch('if (patch.puzzleType != null) {')).toBe(false);
  });

  it('两种类型的差异全部能从表里读出来', () => {
    for (const id of PUZZLE_TYPE_IDS) {
      const c = puzzleConfig(id);
      expect(c.answers.length).toBeGreaterThan(0);
      expect(['judgment', 'submission']).toContain(c.guessMode);
      expect(typeof c.hasBank).toBe('boolean');
    }
  });

  it('表本身对得上 SPEC §4', () => {
    expect(PUZZLE_TYPES.twenty_questions).toMatchObject({
      answers: ['YES', 'NO', 'UNCLEAR', 'CORRECT'],
      defaultBudget: 20,
      hasBank: false,
      guessMode: 'judgment',
    });
    expect(PUZZLE_TYPES.situation).toMatchObject({
      answers: ['YES', 'NO', 'IRRELEVANT', 'BOTH'],
      defaultBudget: null,
      hasBank: true,
      guessMode: 'submission',
    });
  });

  it('只有 20Q 有额度;只有海龟汤有题库 —— 这两条是判定循环和 setup 屏的分流依据', () => {
    expect(puzzleConfig('twenty_questions').defaultBudget).not.toBeNull();
    expect(puzzleConfig('situation').defaultBudget).toBeNull();
    expect(puzzleConfig('situation').hasBank).toBe(true);
    expect(puzzleConfig('twenty_questions').hasBank).toBe(false);
  });
});

describe('i18n 纪律:server 侧无展示字符串(必测 10)', () => {
  it('**server/src 里没有中文字面量**(注释除外)', () => {
    const offenders: string[] = [];
    for (const f of tsFiles(SERVER_SRC)) {
      const code = stripComments(readFileSync(f, 'utf8'));
      if (/[一-鿿]/.test(code)) offenders.push(path.relative(SERVER_SRC, f));
    }
    expect(offenders).toEqual([]);
  });

  it('shared 侧唯一允许的中文是 names.ts 的访客名词表(ADR-10 可删件)', () => {
    const offenders: string[] = [];
    for (const f of tsFiles(SHARED)) {
      const code = stripComments(readFileSync(f, 'utf8'));
      if (/[一-鿿]/.test(code)) offenders.push(path.basename(f));
    }
    // 这条测试是在**锁住例外的范围**:多一个文件冒出中文就红,逼人来这里解释一次。
    expect(offenders).toEqual(['names.ts']);
  });
});
