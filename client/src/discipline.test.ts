/**
 * 视觉纪律的结构测试 —— **把「grep 一遍」变成 CI 里的一条断言。**
 *
 * session 5 的验收里有一条「琥珀纪律 grep 级检查」。手动 grep 一次只能保证今天对;
 * 写成测试才能保证下一个 session 加屏时也对。
 *
 * ⚠️ 同 `server/src/discipline.test.ts` 的教训:**结构扫描必须自带自检**,
 * 否则一条永远为真的断言和一条正确的断言在 CI 里长得一模一样。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(name) || name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return [];
    return [full];
  });
}

const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, '/');

/** 去注释,免得「注释里说别用琥珀」被判成用了琥珀。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 琥珀出现的地方(class 名里带 accent,或 Button 的 focus 变体)。 */
function amberHits(code: string): string[] {
  const hits = [...code.matchAll(/[\w[\]/-]*accent[\w[\]/-]*|variant=\{?["']focus["']/g)];
  return hits.map((m) => m[0]);
}

describe('扫描本身是活的', () => {
  /**
   * 前两个 session 各踩过一次「扫描写歪了但 CI 全绿」。
   * 空集合上的断言永远为真 —— 所以先证明**确实扫到了文件**。
   */
  it('扫得到源文件,不是在空集合上假绿', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(10);
    expect(files.map(rel)).toContain('screens/Playing.tsx');
    expect(files.map(rel)).toContain('components/player.tsx');
  });

  it('测试文件被排除在外(它们本来就会写违规样例)', () => {
    expect(sourceFiles(SRC).map(rel)).not.toContain('discipline.test.ts');
  });
});

describe('琥珀纪律:accent 只允许出现在三焦点(SPEC §9 / DECISIONS #6)', () => {
  /**
   * **允许用琥珀的文件,以及各自的理由。**
   * 加文件到这张表 = 一次明确的决定,而不是顺手写下的一个 class。
   */
  const ALLOWED: Record<string, string> = {
    'components/ui.tsx': 'focus 变体的定义处 —— 它本身就是「琥珀实心」这个东西',
    'components/RoomHeader.tsx': '额度计数(BudgetPill)—— 三焦点之一',
    'screens/Setup.tsx': '汤面区 —— 三焦点之一',
    'screens/Playing.tsx': '汤面区 + ★ 命中(判定组 CORRECT、还原 accept)',
    'screens/Reveal.tsx': '真相区(本屏的汤面区等价物)+ ★ 命中',
  };

  it('没有别的文件碰琥珀', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(f, 'utf8'));
      if (amberHits(code).length > 0 && !(rel(f) in ALLOWED)) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);
  });

  it('允许表里没有过期条目 —— 文件不用琥珀了就该从表里删掉', () => {
    const stale: string[] = [];
    for (const name of Object.keys(ALLOWED)) {
      const full = path.join(SRC, name);
      const code = stripComments(readFileSync(full, 'utf8'));
      if (amberHits(code).length === 0) stale.push(name);
    }
    expect(stale).toEqual([]);
  });

  it('**扫描确实抓得住违规写法**(免得正则写歪了假绿)', () => {
    expect(amberHits('<div className="text-accent">')).toHaveLength(1);
    expect(amberHits('<Panel className="border-accent/40">')).toHaveLength(1);
    expect(amberHits('<Button variant="focus">')).toHaveLength(1);
    expect(amberHits("<Button variant={'focus'}>")).toHaveLength(1);
    // 中性写法不该被误报
    expect(amberHits('<div className="text-ink text-muted border-line">')).toEqual([]);
  });

  it('注释里提到 accent 不算违规', () => {
    expect(amberHits(stripComments('// 这里不许用 text-accent\nconst a = 1;'))).toEqual([]);
    expect(amberHits(stripComments('/** 琥珀 text-accent 只给三焦点 */\nconst b = 2;'))).toEqual([]);
  });
});

describe('serif 只给叙事文本(SPEC §9 修正 4)', () => {
  it('**只有 Narrative 组件能声明 font-serif**', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(f, 'utf8'));
      if (/font-serif/.test(code) && rel(f) !== 'components/ui.tsx') offenders.push(rel(f));
    }
    // 叙事文本一律走 <Narrative>,别的地方想要 serif 就得先来这里解释一次
    expect(offenders).toEqual([]);
  });
});

describe('i18n 纪律:展示字符串只住在 strings.ts', () => {
  /**
   * 屏幕文件里不该有裸的中文字面量 —— 全部走 `t(...)`。
   * (纯符号/图标不算:✓ ✗ ◐ ★ 这些不随语言变。)
   */
  it('screens/ 与 components/ 里没有中文字面量', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles(SRC)) {
      const r = rel(f);
      if (!r.startsWith('screens/') && !r.startsWith('components/')) continue;
      const code = stripComments(readFileSync(f, 'utf8'));
      if (/[一-鿿]/.test(code)) offenders.push(r);
    }
    expect(offenders).toEqual([]);
  });
});
