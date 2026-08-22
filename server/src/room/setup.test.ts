/**
 * setup phase:录题 + 防剧透 + **信息遮蔽**。
 *
 * PROJECT_RIGOR §4 必测 1(view-masking,优先级最高)与必测 8(已用 Set)。
 *
 * 必测 1 值得说清楚为什么它排第一:遮蔽漏了不会抛异常、不会红屏,
 * 游戏照常进行 —— 只是所有 guesser 的 payload 里都躺着汤底,而没有人会发现。
 */

import { describe, expect, it } from 'vitest';
import type { PuzzleListItem, SituationPuzzle } from '@shared/puzzles';
import { Room, type BankPort } from './Room';

const T0 = 1_000_000;

const P1: SituationPuzzle = {
  id: 'p1',
  title: '海龟汤',
  surface: '一个男人喝了一口汤就自杀了。',
  truth: 'SECRET_TRUTH_ONE',
  difficulty: 1,
  tags: ['经典'],
};
const P2: SituationPuzzle = {
  id: 'p2',
  title: '只坐到七楼的人',
  surface: '他每天只坐到七楼。',
  truth: 'SECRET_TRUTH_TWO',
};

const BANK: BankPort = {
  find: (id) => [P1, P2].find((p) => p.id === id),
  list: (used): PuzzleListItem[] =>
    [P1, P2]
      .filter((p) => !used.has(p.id))
      .map((p) => ({ id: p.id, title: p.title })),
};

/** 建一个已经进到 setup 的房:host + oracle。 */
function setupRoom(puzzleType: 'situation' | 'twenty_questions' = 'situation') {
  const r = new Room({
    code: '1234',
    displayNumber: 1,
    host: { id: 'host', nickname: '房主' },
    isPrivate: false,
    now: T0,
    bank: BANK,
  });
  r.addPlayer('oracle', '出题人', T0);
  r.addPlayer('guesser', '猜题人', T0);
  r.updateSettings('host', { puzzleType }, T0);
  r.claimOracle('oracle', T0);
  for (const id of ['host', 'oracle', 'guesser']) r.setReady(id, true, T0);
  const started = r.startGame('host', T0);
  if (!started.ok) throw new Error(`startGame failed: ${started.error}`);
  return r;
}

describe('录题守卫', () => {
  it('只有 oracle 能录题', () => {
    const r = setupRoom();
    expect(r.selectBankPuzzle('guesser', 'p1', T0)).toEqual({ ok: false, error: 'NOT_ORACLE' });
    expect(r.setCustomPuzzle('host', { surface: 'a', truth: 'b' }, T0)).toEqual({
      ok: false,
      error: 'NOT_ORACLE',
    });
    expect(r.clearPuzzle('host', T0)).toEqual({ ok: false, error: 'NOT_ORACLE' });
    expect(r.beginPlaying('guesser', T0)).toEqual({ ok: false, error: 'NOT_ORACLE' });
  });

  it('lobby phase 不能录题', () => {
    const r = new Room({
      code: '1234',
      displayNumber: 1,
      host: { id: 'host', nickname: '房主' },
      isPrivate: false,
      now: T0,
      bank: BANK,
    });
    r.addPlayer('oracle', '出题人', T0);
    r.claimOracle('oracle', T0);
    expect(r.selectBankPuzzle('oracle', 'p1', T0)).toEqual({
      ok: false,
      error: 'NOT_SETUP_PHASE',
    });
  });

  it('题已录好就不能再录 —— 要换先 clearPuzzle(防误覆盖)', () => {
    const r = setupRoom();
    expect(r.selectBankPuzzle('oracle', 'p1', T0).ok).toBe(true);
    expect(r.selectBankPuzzle('oracle', 'p2', T0)).toEqual({
      ok: false,
      error: 'PUZZLE_ALREADY_SET',
    });
    expect(r.puzzle!.bankId).toBe('p1'); // 原题没被覆盖
  });

  it('题库里没有的 id → PUZZLE_NOT_FOUND', () => {
    const r = setupRoom();
    expect(r.selectBankPuzzle('oracle', '不存在', T0)).toEqual({
      ok: false,
      error: 'PUZZLE_NOT_FOUND',
    });
  });

  it('**20Q 没有题库,选题直接被拒**(读 config 表,不判类型)', () => {
    const r = setupRoom('twenty_questions');
    expect(r.hasBank()).toBe(false);
    expect(r.selectBankPuzzle('oracle', 'p1', T0)).toEqual({
      ok: false,
      error: 'BANK_NOT_AVAILABLE',
    });
  });
});

describe('per-room 已用题 Set(必测 8)', () => {
  it('选过的题进已用 Set,并从可选列表里消失', () => {
    const r = setupRoom();
    expect(r.availablePuzzles().map((p) => p.id)).toEqual(['p1', 'p2']);

    r.selectBankPuzzle('oracle', 'p1', T0);
    expect(r.usedPuzzleIds.has('p1')).toBe(true);
    expect(r.availablePuzzles().map((p) => p.id)).toEqual(['p2']);
  });

  it('**换一题之后原题仍然算用过**,不退回列表', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);
    r.clearPuzzle('oracle', T0);

    expect(r.puzzle).toBeNull();
    expect(r.usedPuzzleIds.has('p1')).toBe(true);
    expect(r.availablePuzzles().map((p) => p.id)).toEqual(['p2']); // p1 没回来
  });

  it('用过的题再选一次 → PUZZLE_ALREADY_USED', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);
    r.clearPuzzle('oracle', T0);
    expect(r.selectBankPuzzle('oracle', 'p1', T0)).toEqual({
      ok: false,
      error: 'PUZZLE_ALREADY_USED',
    });
  });

  it('已用 Set 是 per-room 的 —— 另一个房间不受影响', () => {
    const a = setupRoom();
    const b = setupRoom();
    a.selectBankPuzzle('oracle', 'p1', T0);
    expect(b.availablePuzzles().map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('题库用光 → bankExhausted 为真(client 该引导去自写)', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);
    r.clearPuzzle('oracle', T0);
    r.selectBankPuzzle('oracle', 'p2', T0);
    r.clearPuzzle('oracle', T0);
    expect(r.toClientState('oracle').bankExhausted).toBe(true);
    expect(r.toClientState('oracle').bank).toEqual([]);
  });
});

describe('自写题 / 20Q 答案词 —— 同一条路径', () => {
  it('海龟汤自写:汤面 + 汤底两栏都必填', () => {
    const r = setupRoom();
    expect(r.setCustomPuzzle('oracle', { surface: '汤面', truth: '' }, T0)).toEqual({
      ok: false,
      error: 'INVALID_PUZZLE',
    });
    expect(r.setCustomPuzzle('oracle', { surface: '', truth: '汤底' }, T0)).toEqual({
      ok: false,
      error: 'INVALID_PUZZLE',
    });
    expect(r.setCustomPuzzle('oracle', { surface: '汤面', truth: '汤底' }, T0).ok).toBe(true);
    expect(r.puzzle).toMatchObject({ source: 'own', bankId: null, surface: '汤面' });
  });

  it('**20Q 只要答案词,不接受汤面**', () => {
    const r = setupRoom('twenty_questions');
    expect(r.setCustomPuzzle('oracle', { surface: '不该有', truth: '长颈鹿' }, T0).ok).toBe(true);
    expect(r.puzzle!.surface).toBeNull(); // 汤面被丢掉,不是存起来
    expect(r.puzzle!.truth).toBe('长颈鹿');
  });

  it('超长内容被拒', () => {
    const r = setupRoom();
    expect(
      r.setCustomPuzzle('oracle', { surface: 'a'.repeat(601), truth: 'b' }, T0),
    ).toEqual({ ok: false, error: 'INVALID_PUZZLE' });
  });

  it('20Q 的答案词上限比汤底短得多', () => {
    const r = setupRoom('twenty_questions');
    expect(r.setCustomPuzzle('oracle', { truth: 'x'.repeat(41) }, T0)).toEqual({
      ok: false,
      error: 'INVALID_PUZZLE',
    });
    expect(r.setCustomPuzzle('oracle', { truth: 'x'.repeat(40) }, T0).ok).toBe(true);
  });

  it('前后空白被 trim,纯空白等于没填', () => {
    const r = setupRoom();
    expect(r.setCustomPuzzle('oracle', { surface: '  \n ', truth: '汤底' }, T0)).toEqual({
      ok: false,
      error: 'INVALID_PUZZLE',
    });
    r.setCustomPuzzle('oracle', { surface: '  汤面  ', truth: ' 汤底 ' }, T0);
    expect(r.puzzle!.surface).toBe('汤面');
  });
});

describe('开汤 / 锁定 → playing', () => {
  it('题没录好不许开', () => {
    const r = setupRoom();
    expect(r.beginPlaying('oracle', T0)).toEqual({ ok: false, error: 'NO_PUZZLE_SET' });
    expect(r.phase).toBe('setup');
  });

  it('题录好了就能进 playing', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);
    expect(r.beginPlaying('oracle', T0).ok).toBe(true);
    expect(r.phase).toBe('playing');
  });

  it('已经在 playing 就不能再开一次', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);
    r.beginPlaying('oracle', T0);
    expect(r.beginPlaying('oracle', T0)).toEqual({ ok: false, error: 'NOT_SETUP_PHASE' });
  });

  it('playing 之后不能改题', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);
    r.beginPlaying('oracle', T0);
    expect(r.clearPuzzle('oracle', T0)).toEqual({ ok: false, error: 'NOT_SETUP_PHASE' });
  });
});

describe('★ 信息遮蔽 —— 必测 1,优先级最高', () => {
  it('**汤底只出现在 oracle 那一份 state 里**', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);

    expect(r.toClientState('oracle').oracleTruth).toBe('SECRET_TRUTH_ONE');
    expect(r.toClientState('guesser').oracleTruth).toBeNull();
    expect(r.toClientState('host').oracleTruth).toBeNull(); // host 也不行 —— 两权分离
  });

  it('**guesser / host 的整份 payload 里搜不到汤底字符串**', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);

    for (const viewer of ['guesser', 'host']) {
      expect(JSON.stringify(r.toClientState(viewer))).not.toContain('SECRET_TRUTH_ONE');
    }
    expect(JSON.stringify(r.toClientState('oracle'))).toContain('SECRET_TRUTH_ONE');
  });

  it('汤面对**全房**公开 —— guesser 要先读汤面(SPEC §3)', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);

    for (const viewer of ['oracle', 'guesser', 'host']) {
      expect(r.toClientState(viewer).puzzle?.surface).toBe(P1.surface);
    }
  });

  it('**20Q 的答案词对 guesser 完全不可见,连 surface 都没有**', () => {
    const r = setupRoom('twenty_questions');
    r.setCustomPuzzle('oracle', { truth: '长颈鹿' }, T0);

    const g = r.toClientState('guesser');
    expect(g.puzzle).toEqual({ title: null, surface: null, ready: true });
    expect(g.oracleTruth).toBeNull();
    expect(JSON.stringify(g)).not.toContain('长颈鹿');

    // oracle 自己看得见
    expect(r.toClientState('oracle').oracleTruth).toBe('长颈鹿');
  });

  it('**选题列表只发给 oracle** —— 让 guesser 看见候选题名本身就是剧透', () => {
    const r = setupRoom();
    expect(r.toClientState('oracle').bank).toEqual([
      { id: 'p1', title: '海龟汤' },
      { id: 'p2', title: '只坐到七楼的人' },
    ]);
    expect(r.toClientState('guesser').bank).toBeNull();
    expect(r.toClientState('host').bank).toBeNull();
  });

  it('列表里也不含任何汤面汤底', () => {
    const r = setupRoom();
    const json = JSON.stringify(r.toClientState('oracle').bank);
    expect(json).not.toContain(P1.truth);
    expect(json).not.toContain(P1.surface);
    expect(json).not.toContain(P2.truth);
  });

  it('题还没录 → puzzle 为 null,谁都看不到东西', () => {
    const r = setupRoom();
    for (const viewer of ['oracle', 'guesser', 'host']) {
      expect(r.toClientState(viewer).puzzle).toBeNull();
      expect(r.toClientState(viewer).oracleTruth).toBeNull();
    }
  });

  it('**换 oracle 之后,旧 oracle 立刻看不到汤底,新 oracle 看得到**', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);
    expect(r.toClientState('oracle').oracleTruth).toBe('SECRET_TRUTH_ONE');

    // 回 lobby 才能改派(中段接管留给断线 session),这里直接改字段模拟座位易主
    r.oracleId = 'guesser';

    expect(r.toClientState('oracle').oracleTruth).toBeNull();
    expect(r.toClientState('guesser').oracleTruth).toBe('SECRET_TRUTH_ONE');
  });

  it('公开面是 whitelist:给 PuzzleDraft 加字段不会漏给 guesser', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);
    (r.puzzle as unknown as Record<string, unknown>).oracleNote = '这条不该出现';

    expect(JSON.stringify(r.toClientState('guesser'))).not.toContain('这条不该出现');
  });

  it('**lobby 行永远不带题目信息** —— toSummary 仍是 8 个字段', () => {
    const r = setupRoom();
    r.selectBankPuzzle('oracle', 'p1', T0);
    const s = r.toSummary();
    expect(Object.keys(s)).toHaveLength(8);
    expect(JSON.stringify(s)).not.toContain('SECRET_TRUTH_ONE');
    expect(JSON.stringify(s)).not.toContain(P1.surface);
  });
});
