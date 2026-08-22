/**
 * 出题人交接(SPEC §3)+ oracle 中段接管(SPEC §7)—— **先写的用例。**
 *
 * 这是座位规则的最后一块。两条规则容易混:
 *   · **交接**发生在 reveal → setup 的边上,是「下一局谁出题」;
 *   · **接管**发生在任意 phase 中途,是「这一局接下来谁判」。
 * 前者由 outcome 决定默认值、host 可改;后者只有 host 能发起,且**不许打断牌局状态**。
 */

import { describe, expect, it } from 'vitest';
import type { SituationPuzzle } from '@shared/puzzles';
import { Room, type BankPort } from './Room';

const T0 = 1_000_000;

const P1: SituationPuzzle = { id: 'p1', title: '汤', surface: '汤面', truth: 'SECRET_TRUTH' };
const BANK: BankPort = {
  find: (id) => (id === 'p1' ? P1 : undefined),
  list: (used) => (used.has('p1') ? [] : [{ id: 'p1', title: '汤' }]),
};

function room(puzzleType: 'situation' | 'twenty_questions' = 'twenty_questions', budget = 20) {
  const r = new Room({
    code: '1234',
    displayNumber: 1,
    host: { id: 'host', nickname: 'H' },
    isPrivate: false,
    now: T0,
    bank: BANK,
  });
  r.addPlayer('oracle', 'O', T0);
  r.addPlayer('g1', 'G1', T0);
  r.addPlayer('g2', 'G2', T0);
  r.updateSettings('host', { puzzleType }, T0);
  if (puzzleType === 'twenty_questions') r.updateSettings('host', { budget }, T0);
  r.updateSettings('host', { pendingCap: 3 }, T0);
  r.claimOracle('oracle', T0);
  for (const id of ['host', 'oracle', 'g1', 'g2']) r.setReady(id, true, T0);
  r.startGame('host', T0);
  return r;
}

/** 推到 playing,题已录好。 */
function playing(puzzleType: 'situation' | 'twenty_questions' = 'twenty_questions', budget = 20) {
  const r = room(puzzleType, budget);
  if (puzzleType === 'situation') r.selectBankPuzzle('oracle', 'p1', T0);
  else r.setCustomPuzzle('oracle', { truth: 'ANSWER' }, T0);
  r.beginPlaying('oracle', T0);
  return r;
}

function ask(r: Room, who: string, text = 'q') {
  const res = r.askQuestion(who, text, T0);
  if (!res.ok) throw new Error(`ask(${who}): ${res.error}`);
  return res.value;
}

/* ═══════════════════ 交接策略:默认值怎么定 ═══════════════════ */

describe('交接策略 1 —— 猜中者接棒', () => {
  it('**20Q 判 CORRECT → 下一局出题人默认是那个提问者**', () => {
    const r = playing();
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);

    expect(r.outcome!.winnerId).toBe('g2');
    expect(r.nextOracleId).toBe('g2');
  });

  it('**海龟汤 accept → 下一局出题人默认是提交者**', () => {
    const r = playing('situation');
    const s = r.submitSolution('g1', '还原', T0);
    if (!s.ok) throw new Error('submit failed');
    r.resolveSubmission('oracle', s.value.id, true, T0);

    expect(r.nextOracleId).toBe('g1');
  });
});

describe('交接策略 2 —— 未猜中则 oracle 连任', () => {
  it('额度耗尽 → oracle 连任', () => {
    const r = playing('twenty_questions', 1);
    ask(r, 'g1');
    r.judge('oracle', 'NO', T0);

    expect(r.outcome!.result).toBe('exhausted');
    expect(r.nextOracleId).toBe('oracle'); // ← 不是 null,是连任
  });

  it('oracle 公开汤底 → 也是连任', () => {
    const r = playing('situation');
    r.revealTruth('oracle', T0);

    expect(r.outcome!.result).toBe('revealed');
    expect(r.nextOracleId).toBe('oracle');
  });

  it('还原被 reject 不算收束,不产生交接', () => {
    const r = playing('situation');
    const s = r.submitSolution('g1', '猜错的', T0);
    if (!s.ok) throw new Error('submit failed');
    r.resolveSubmission('oracle', s.value.id, false, T0);

    expect(r.nextOracleId).toBeNull(); // 还没收束
    expect(r.phase).toBe('playing');
  });
});

describe('交接策略 3 —— host 在 reveal 改派', () => {
  it('host 可以把下一局出题人改成别人', () => {
    const r = playing();
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);
    expect(r.nextOracleId).toBe('g2');

    expect(r.setNextOracle('host', 'g1', T0).ok).toBe(true);
    expect(r.nextOracleId).toBe('g1');
  });

  it('可以改成 null(下一局没人坐,回 setup 后需要有人上位)', () => {
    const r = playing();
    ask(r, 'g1');
    r.judge('oracle', 'CORRECT', T0);
    expect(r.setNextOracle('host', null, T0).ok).toBe(true);
    expect(r.nextOracleId).toBeNull();
  });

  it('**只有 host 能改** —— 连命中者自己都不能', () => {
    const r = playing();
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);
    expect(r.setNextOracle('g2', 'g2', T0)).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(r.setNextOracle('oracle', 'oracle', T0)).toEqual({ ok: false, error: 'NOT_HOST' });
  });

  it('**只有 reveal phase 能改** —— 局中改的是接管,不是交接', () => {
    const r = playing();
    expect(r.setNextOracle('host', 'g1', T0)).toEqual({ ok: false, error: 'NOT_REVEAL_PHASE' });
  });

  it('不能派给不在房里的人', () => {
    const r = playing();
    ask(r, 'g1');
    r.judge('oracle', 'CORRECT', T0);
    expect(r.setNextOracle('host', '查无此人', T0)).toEqual({
      ok: false,
      error: 'PLAYER_NOT_FOUND',
    });
  });
});

/* ═══════════════ startNextRound 应用交接结果 ═══════════════ */

describe('startNextRound 把交接结果落到座位上', () => {
  it('**命中者真的坐上了 oracle 位**', () => {
    const r = playing();
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);

    expect(r.startNextRound('host', T0).ok).toBe(true);
    expect(r.oracleId).toBe('g2'); // ← 换人了
    expect(r.phase).toBe('setup');
  });

  it('连任的情况下座位不动', () => {
    const r = playing('situation');
    r.revealTruth('oracle', T0);
    r.startNextRound('host', T0);
    expect(r.oracleId).toBe('oracle');
  });

  it('host 改派之后,坐上的是改派的那个', () => {
    const r = playing();
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);
    r.setNextOracle('host', 'g1', T0);
    r.startNextRound('host', T0);
    expect(r.oracleId).toBe('g1');
  });

  it('**接棒的人如果已经离开房间 → 座位空出来,不是崩掉**', () => {
    const r = playing();
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);
    r.removePlayer('g2', T0); // 命中者跑了

    expect(r.startNextRound('host', T0).ok).toBe(true);
    expect(r.oracleId).toBeNull(); // 留给活人上位
    expect(r.phase).toBe('setup');
  });

  it('交接完成后 nextOracleId 归零 —— 不会渗到下一局', () => {
    const r = playing();
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);
    r.startNextRound('host', T0);
    expect(r.nextOracleId).toBeNull();
  });

  it('**回 lobby 那条边不做交接** —— 改设置不是换人', () => {
    const r = playing();
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);

    expect(r.backToLobby('host', T0).ok).toBe(true);
    expect(r.oracleId).toBe('oracle'); // 座位保持原样
    expect(r.nextOracleId).toBeNull();
  });

  it('归位仍然彻底 —— 交接不影响别的清理', () => {
    const r = playing();
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);
    r.startNextRound('host', T0);

    expect(r.puzzle).toBeNull();
    expect(r.queue).toEqual([]);
    expect(r.history).toEqual([]);
    expect(r.outcome).toBeNull();
    expect(r.budgetLeft).toBeNull();
  });
});

/* ═══════════════ oracle 中段接管(SPEC §7)═══════════════ */

describe('中段接管:host 任意 phase 可转移出题人', () => {
  it('**playing 中途 host 可以转移** —— 这是 SPEC §7 的红利,游戏不死', () => {
    const r = playing('situation');
    expect(r.assignOracle('host', 'g1', T0).ok).toBe(true);
    expect(r.oracleId).toBe('g1');
    expect(r.phase).toBe('playing'); // 没被打断
  });

  it('setup 中途也可以', () => {
    const r = room('situation');
    expect(r.phase).toBe('setup');
    expect(r.assignOracle('host', 'g1', T0).ok).toBe(true);
    expect(r.oracleId).toBe('g1');
  });

  it('reveal 中途也可以(和 setNextOracle 是两回事)', () => {
    const r = playing('situation');
    r.revealTruth('oracle', T0);
    expect(r.assignOracle('host', 'g1', T0).ok).toBe(true);
    expect(r.oracleId).toBe('g1');
  });

  it('lobby 阶段行为不变', () => {
    const r = new Room({
      code: '1',
      displayNumber: 1,
      host: { id: 'host', nickname: 'H' },
      isPrivate: false,
      now: T0,
    });
    r.addPlayer('g1', 'G1', T0);
    expect(r.assignOracle('host', 'g1', T0).ok).toBe(true);
    expect(r.oracleId).toBe('g1');
  });

  it('**只有 host 能转移** —— 不是抢座位', () => {
    const r = playing('situation');
    expect(r.assignOracle('g1', 'g1', T0)).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(r.assignOracle('oracle', 'g1', T0)).toEqual({ ok: false, error: 'NOT_HOST' });
  });

  it('不能转给不在房里的人', () => {
    const r = playing('situation');
    expect(r.assignOracle('host', '查无此人', T0)).toEqual({
      ok: false,
      error: 'PLAYER_NOT_FOUND',
    });
  });

  it('中段也能清空座位(oracle 掉线且暂时没人接)', () => {
    const r = playing('situation');
    expect(r.assignOracle('host', null, T0).ok).toBe(true);
    expect(r.oracleId).toBeNull();
  });
});

describe('接管:truth 投影跟着座位走', () => {
  it('**新 oracle 拿到 truth,原 oracle 立刻失去**', () => {
    const r = playing('situation');
    expect(r.toClientState('oracle').oracleTruth).toBe('SECRET_TRUTH');
    expect(r.toClientState('g1').oracleTruth).toBeNull();

    r.assignOracle('host', 'g1', T0);

    expect(r.toClientState('g1').oracleTruth).toBe('SECRET_TRUTH'); // 接管者读得到
    expect(r.toClientState('oracle').oracleTruth).toBeNull(); // 前任读不到了
  });

  it('前任的整份 payload 里搜不到汤底', () => {
    const r = playing('situation');
    r.assignOracle('host', 'g1', T0);
    expect(JSON.stringify(r.toClientState('oracle'))).not.toContain('SECRET_TRUTH');
  });

  it('接管者随即就能判定;前任不能', () => {
    const r = playing('situation');
    ask(r, 'g2');
    r.assignOracle('host', 'g1', T0);

    expect(r.judge('oracle', 'YES', T0)).toEqual({ ok: false, error: 'NOT_ORACLE' });
    expect(r.judge('g1', 'YES', T0).ok).toBe(true);
  });

  it('setup 中途接管:新 oracle 看得到题库,前任看不到', () => {
    const r = room('situation');
    r.assignOracle('host', 'g1', T0);
    expect(r.toClientState('g1').bank).not.toBeNull();
    expect(r.toClientState('oracle').bank).toBeNull();
  });
});

describe('接管:**不许打断牌局状态**', () => {
  it('队列、历史、额度、pending 一律不动', () => {
    const r = playing('twenty_questions', 10);
    ask(r, 'g1');
    ask(r, 'g2');
    r.judge('oracle', 'NO', T0);
    ask(r, 'g1');

    const before = {
      queue: r.queue.map((q) => q.id),
      history: r.history.map((q) => q.id),
      budget: r.budgetLeft,
      pendingG1: r.pendingCountOf('g1'),
    };

    r.assignOracle('host', 'g2', T0);

    expect(r.queue.map((q) => q.id)).toEqual(before.queue);
    expect(r.history.map((q) => q.id)).toEqual(before.history);
    expect(r.budgetLeft).toBe(before.budget);
    expect(r.pendingCountOf('g1')).toBe(before.pendingG1);
  });

  it('题目本身不动 —— 换的是判的人,不是题', () => {
    const r = playing('situation');
    const truthBefore = r.puzzle!.truth;
    r.assignOracle('host', 'g1', T0);
    expect(r.puzzle!.truth).toBe(truthBefore);
  });

  it('还原提交不受影响', () => {
    const r = playing('situation');
    const s = r.submitSolution('g2', '还原', T0);
    if (!s.ok) throw new Error('submit failed');

    r.assignOracle('host', 'g1', T0);
    expect(r.submissions).toHaveLength(1);
    expect(r.submissions[0]!.status).toBe('pending');
    expect(r.resolveSubmission('g1', s.value.id, false, T0).ok).toBe(true); // 新 oracle 处理得了
  });

  it('**接管者自己队里的问题保留** —— 不退额度,不改队列', () => {
    const r = playing('twenty_questions', 10);
    const q = ask(r, 'g1');
    const budgetBefore = r.budgetLeft;

    r.assignOracle('host', 'g1', T0); // g1 从提问者变成 oracle

    expect(r.queue.map((x) => x.id)).toContain(q.id); // 还在队里
    expect(r.budgetLeft).toBe(budgetBefore); // 额度没退
    // 由 ta 自己判掉 —— co-op 里这不构成作弊,ta 现在本来就知道答案
    expect(r.judge('g1', 'YES', T0).ok).toBe(true);
  });

  it('接管之后原 oracle 变回 guesser,可以提问', () => {
    const r = playing('situation');
    expect(r.askQuestion('oracle', 'q', T0)).toEqual({ ok: false, error: 'ORACLE_CANNOT_ASK' });

    r.assignOracle('host', 'g1', T0);
    expect(r.askQuestion('oracle', 'q', T0).ok).toBe(true); // 前任现在能问了
    expect(r.askQuestion('g1', 'q', T0)).toEqual({ ok: false, error: 'ORACLE_CANNOT_ASK' });
  });
});

/* ═══════════════ reveal 屏要的数据都在 outcome / 现有状态里 ═══════════════ */

describe('reveal 屏的数据来源(不新增持久面)', () => {
  it('命中的那条**问题**在 history 里找得到', () => {
    const r = playing();
    ask(r, 'g1', '第一问');
    r.judge('oracle', 'NO', T0);
    ask(r, 'g2', '是长颈鹿吗');
    r.judge('oracle', 'CORRECT', T0);

    expect(r.outcome!.via).toBe('judgment');
    const hit = r.history.find((q) => q.answer === 'CORRECT');
    expect(hit!.text).toBe('是长颈鹿吗');
    expect(hit!.askerId).toBe('g2');
  });

  it('命中的那条**还原**在 submissions 里找得到', () => {
    const r = playing('situation');
    const s = r.submitSolution('g1', '他吃的是同伴的肉', T0);
    if (!s.ok) throw new Error('submit failed');
    r.resolveSubmission('oracle', s.value.id, true, T0);

    expect(r.outcome!.via).toBe('submission');
    const hit = r.submissions.find((x) => x.status === 'accepted');
    expect(hit!.text).toBe('他吃的是同伴的肉');
  });

  it('reveal 期间 history / submissions 仍在(归位发生在离开 reveal 时)', () => {
    const r = playing();
    ask(r, 'g1');
    r.judge('oracle', 'CORRECT', T0);
    expect(r.phase).toBe('reveal');
    expect(r.history).toHaveLength(1);
  });

  it('**收束后真相对全房公开**,连接棒者也看得到', () => {
    const r = playing('situation');
    r.revealTruth('oracle', T0);
    for (const viewer of ['host', 'g1', 'g2', 'oracle']) {
      expect(r.toClientState(viewer).outcome!.truth).toBe('SECRET_TRUTH');
    }
  });

  it('nextOracleId 全房可见 —— 大家都该看到下一局谁出题', () => {
    const r = playing();
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);
    for (const viewer of ['host', 'g1', 'g2', 'oracle']) {
      expect(r.toClientState(viewer).nextOracleId).toBe('g2');
    }
  });
});
