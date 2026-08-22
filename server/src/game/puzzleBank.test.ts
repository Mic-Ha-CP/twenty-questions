/**
 * 题库模块 + 防剧透投影 + 20Q 建议词表。
 * PROJECT_RIGOR §4 必测 8(per-room 已用 Set)的题库那一半。
 */

import { describe, expect, it } from 'vitest';
import { toListItem } from '@shared/puzzles';
import {
  bankSize,
  findPuzzle,
  isExhausted,
  listAvailable,
  suggestAnswerWord,
  suggestionCount,
} from './puzzleBank';

describe('题库加载', () => {
  it('data/puzzles.zh.json 读得到,且不是空的', () => {
    expect(bankSize()).toBeGreaterThanOrEqual(3);
  });

  it('每题都齐 id / title / surface / truth', () => {
    for (const item of listAvailable(new Set())) {
      const full = findPuzzle(item.id)!;
      expect(full.title.length).toBeGreaterThan(0);
      expect(full.surface.length).toBeGreaterThan(0);
      expect(full.truth.length).toBeGreaterThan(0);
    }
  });

  it('id 唯一(重复会在加载时抛,这里再兜一次)', () => {
    const ids = listAvailable(new Set()).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('找不到的 id 返回 undefined,不抛', () => {
    expect(findPuzzle('does-not-exist')).toBeUndefined();
  });
});

describe('防剧透投影:列表只出 title + tags/difficulty', () => {
  it('**列表项里没有 surface 和 truth**', () => {
    const list = listAvailable(new Set());
    for (const item of list) {
      expect(item).not.toHaveProperty('surface');
      expect(item).not.toHaveProperty('truth');
    }
    // 整串序列化里也不能出现任何一题的汤面/汤底
    const json = JSON.stringify(list);
    for (const item of list) {
      const full = findPuzzle(item.id)!;
      expect(json).not.toContain(full.surface);
      expect(json).not.toContain(full.truth);
    }
  });

  it('投影是 whitelist:给题目加字段不会漏进列表项', () => {
    const full = findPuzzle(listAvailable(new Set())[0]!.id)!;
    const tampered = { ...full, secretNote: '这条不该出现' };
    expect(JSON.stringify(toListItem(tampered))).not.toContain('这条不该出现');
  });

  it('可选字段缺席时不会出现为 undefined 键', () => {
    const item = toListItem({ id: 'x', title: 't', surface: 's', truth: 'r' });
    expect(Object.keys(item)).toEqual(['id', 'title']);
  });
});

describe('per-room 已用 Set:同房不重复(必测 8)', () => {
  it('已用的题**不出现**在列表里(不是置灰,是不出现)', () => {
    const all = listAvailable(new Set());
    const used = new Set([all[0]!.id]);
    const after = listAvailable(used);

    expect(after).toHaveLength(all.length - 1);
    expect(after.map((p) => p.id)).not.toContain(all[0]!.id);
  });

  it('用光之后 isExhausted 为真,列表为空', () => {
    const all = new Set(listAvailable(new Set()).map((p) => p.id));
    expect(isExhausted(all)).toBe(true);
    expect(listAvailable(all)).toEqual([]);
  });

  it('空 Set 时没有任何题被挡住 —— 换房 = 重置', () => {
    expect(isExhausted(new Set())).toBe(false);
    expect(listAvailable(new Set())).toHaveLength(bankSize());
  });
});

describe('20Q 建议词表 —— 不是题库', () => {
  it('给得出词', () => {
    expect(suggestionCount()).toBeGreaterThan(5);
    expect(suggestAnswerWord().length).toBeGreaterThan(0);
  });

  it('exclude 能避开上一个词(「再来一个」不会原地打转)', () => {
    const first = suggestAnswerWord();
    for (let i = 0; i < 30; i++) {
      expect(suggestAnswerWord(first)).not.toBe(first);
    }
  });

  it('**建议词和题库是两套东西** —— 建议词不是任何一题的题名', () => {
    const titles = new Set(listAvailable(new Set()).map((p) => p.title));
    for (let i = 0; i < 30; i++) {
      expect(titles.has(suggestAnswerWord())).toBe(false);
    }
  });
});
