/**
 * 判定循环(SPEC §5)—— **先写的用例,后写的实现。**
 *
 * PROJECT_RIGOR §4 必测 3(额度记账)与 4(FIFO + pending cap)。
 * 额度那组是全 SPEC 最容易写反的:入队即扣 / UNCLEAR 不退 / CORRECT 立即收束 /
 * 归零后拒绝入队但已在队照判 / pending cap 与额度**独立**计算。
 * 每一条都单独有用例,因为它们两两之间很容易互相污染。
 */

import { describe, expect, it } from 'vitest';
import type { SituationPuzzle } from '@shared/puzzles';
import { Room, type BankPort } from './Room';

const T0 = 1_000_000;

const P1: SituationPuzzle = {
  id: 'p1',
  title: '海龟汤',
  surface: '汤面',
  truth: 'SECRET_TRUTH',
};
const BANK: BankPort = {
  find: (id) => (id === 'p1' ? P1 : undefined),
  list: (used) => (used.has('p1') ? [] : [{ id: 'p1', title: '海龟汤' }]),
};

/**
 * 建一个已经在 playing 的房:host + oracle + 两个 guesser。
 * `budget` 只对有额度的类型有意义。
 */
function playingRoom(
  puzzleType: 'situation' | 'twenty_questions' = 'twenty_questions',
  opts: { budget?: number; pendingCap?: number } = {},
) {
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
  if (opts.budget !== undefined) r.updateSettings('host', { budget: opts.budget }, T0);
  if (opts.pendingCap !== undefined) r.updateSettings('host', { pendingCap: opts.pendingCap }, T0);
  r.claimOracle('oracle', T0);
  for (const id of ['host', 'oracle', 'g1', 'g2']) r.setReady(id, true, T0);
  const started = r.startGame('host', T0);
  if (!started.ok) throw new Error(`startGame: ${started.error}`);

  if (puzzleType === 'situation') {
    const sel = r.selectBankPuzzle('oracle', 'p1', T0);
    if (!sel.ok) throw new Error(`selectBankPuzzle: ${sel.error}`);
  } else {
    const set = r.setCustomPuzzle('oracle', { truth: 'ANSWER_WORD' }, T0);
    if (!set.ok) throw new Error(`setCustomPuzzle: ${set.error}`);
  }
  const begun = r.beginPlaying('oracle', T0);
  if (!begun.ok) throw new Error(`beginPlaying: ${begun.error}`);
  return r;
}

/** 入队一条并断言成功。 */
function ask(r: Room, who: string, text = 'q', now = T0) {
  const res = r.askQuestion(who, text, now);
  if (!res.ok) throw new Error(`askQuestion(${who}): ${res.error}`);
  return res.value;
}

/* ══════════════════════════ 额度记账(必测 3)══════════════════════════ */

describe('额度:入队即扣', () => {
  it('进 playing 时额度取自设置', () => {
    expect(playingRoom('twenty_questions', { budget: 20 }).budgetLeft).toBe(20);
    expect(playingRoom('twenty_questions', { budget: 5 }).budgetLeft).toBe(5);
  });

  it('**入队就扣,不是判定时才扣**', () => {
    const r = playingRoom('twenty_questions', { budget: 3 });
    ask(r, 'g1');
    expect(r.budgetLeft).toBe(2); // 还没判就已经扣了
    expect(r.queue).toHaveLength(1);
  });

  it('判定不再扣第二次', () => {
    const r = playingRoom('twenty_questions', { budget: 3 });
    ask(r, 'g1');
    r.judge('oracle', 'YES', T0);
    expect(r.budgetLeft).toBe(2); // 判完还是 2,不是 1
  });

  it('海龟汤无额度 —— budgetLeft 恒为 null,入队不扣', () => {
    const r = playingRoom('situation');
    expect(r.budgetLeft).toBeNull();
    ask(r, 'g1');
    ask(r, 'g2');
    expect(r.budgetLeft).toBeNull();
  });
});

describe('额度:UNCLEAR 不退', () => {
  it('**判 UNCLEAR 不把额度还回去**', () => {
    const r = playingRoom('twenty_questions', { budget: 3 });
    ask(r, 'g1');
    expect(r.budgetLeft).toBe(2);
    r.judge('oracle', 'UNCLEAR', T0);
    expect(r.budgetLeft).toBe(2); // ← 不是 3
  });

  it('YES / NO 同样不退', () => {
    const r = playingRoom('twenty_questions', { budget: 5 });
    ask(r, 'g1');
    r.judge('oracle', 'YES', T0);
    ask(r, 'g2');
    r.judge('oracle', 'NO', T0);
    expect(r.budgetLeft).toBe(3);
  });
});

describe('额度:归零后拒绝入队,但已在队的照判', () => {
  it('归零后入队被拒', () => {
    const r = playingRoom('twenty_questions', { budget: 1 });
    ask(r, 'g1');
    expect(r.budgetLeft).toBe(0);
    expect(r.askQuestion('g2', 'q', T0)).toEqual({ ok: false, error: 'NO_BUDGET_LEFT' });
  });

  it('**归零时已经在队里的仍然要判** —— 额度是入队许可证,不是判定许可证', () => {
    const r = playingRoom('twenty_questions', { budget: 2, pendingCap: 1 });
    ask(r, 'g1');
    ask(r, 'g2');
    expect(r.budgetLeft).toBe(0);
    expect(r.queue).toHaveLength(2);

    expect(r.judge('oracle', 'YES', T0).ok).toBe(true);
    expect(r.queue).toHaveLength(1);
    expect(r.judge('oracle', 'NO', T0).ok).toBe(true); // 第二条照判
  });

  it('额度归零 + 队列判空 + 无 CORRECT → guessers 失败收束', () => {
    const r = playingRoom('twenty_questions', { budget: 2, pendingCap: 1 });
    ask(r, 'g1');
    ask(r, 'g2');
    r.judge('oracle', 'YES', T0);
    expect(r.outcome).toBeNull(); // 队里还有一条,不算完

    r.judge('oracle', 'NO', T0);
    expect(r.outcome).toMatchObject({ result: 'exhausted', winnerId: null });
    expect(r.phase).toBe('reveal');
  });

  it('额度归零但队列没判空 → 还没结束', () => {
    const r = playingRoom('twenty_questions', { budget: 2, pendingCap: 2 });
    ask(r, 'g1');
    ask(r, 'g1');
    expect(r.budgetLeft).toBe(0);
    expect(r.phase).toBe('playing');
    expect(r.outcome).toBeNull();
  });

  it('额度还有但队列空了 → 当然不算结束', () => {
    const r = playingRoom('twenty_questions', { budget: 5 });
    ask(r, 'g1');
    r.judge('oracle', 'YES', T0);
    expect(r.queue).toHaveLength(0);
    expect(r.phase).toBe('playing');
  });
});

describe('额度:CORRECT 立即收束', () => {
  it('**判 CORRECT → 立刻 reveal,提问者记为命中者**', () => {
    const r = playingRoom('twenty_questions', { budget: 20 });
    ask(r, 'g2', '是长颈鹿吗');
    r.judge('oracle', 'CORRECT', T0 + 5000);

    expect(r.phase).toBe('reveal');
    expect(r.outcome).toMatchObject({ result: 'hit', winnerId: 'g2' });
  });

  it('收束时把真相快照进 outcome —— reveal 屏要用', () => {
    const r = playingRoom('twenty_questions', { budget: 20 });
    ask(r, 'g1');
    r.judge('oracle', 'CORRECT', T0);
    expect(r.outcome!.truth).toBe('ANSWER_WORD');
  });

  it('记录共用几问、用时', () => {
    const r = playingRoom('twenty_questions', { budget: 20, pendingCap: 3 });
    ask(r, 'g1');
    r.judge('oracle', 'NO', T0);
    ask(r, 'g2');
    r.judge('oracle', 'NO', T0);
    ask(r, 'g1');
    r.judge('oracle', 'CORRECT', T0 + 60_000);

    expect(r.outcome!.questionsUsed).toBe(3);
    expect(r.outcome!.durationMs).toBe(60_000);
  });

  it('CORRECT 之后队列里剩下的不再判', () => {
    const r = playingRoom('twenty_questions', { budget: 20, pendingCap: 3 });
    ask(r, 'g1');
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);
    expect(r.judge('oracle', 'YES', T0)).toEqual({ ok: false, error: 'NOT_PLAYING_PHASE' });
  });

  it('CORRECT 之后不能再入队', () => {
    const r = playingRoom('twenty_questions', { budget: 20 });
    ask(r, 'g1');
    r.judge('oracle', 'CORRECT', T0);
    expect(r.askQuestion('g2', 'q', T0)).toEqual({ ok: false, error: 'NOT_PLAYING_PHASE' });
  });

  it('**co-op:群体胜利,个人只是标注** —— winnerId 是谁不影响结果本身', () => {
    const r = playingRoom('twenty_questions', { budget: 20 });
    ask(r, 'g2');
    r.judge('oracle', 'CORRECT', T0);
    expect(r.outcome!.result).toBe('hit'); // 不是「g2 赢了」,是这一局赢了
    expect(r.outcome!.winnerId).toBe('g2'); // 谁问出来的,记一笔
  });
});

describe('额度 与 pending cap 是两套账,互不影响', () => {
  it('pending cap 拦住的入队**不扣额度**', () => {
    const r = playingRoom('twenty_questions', { budget: 5, pendingCap: 1 });
    ask(r, 'g1');
    expect(r.budgetLeft).toBe(4);

    expect(r.askQuestion('g1', 'again', T0)).toEqual({ ok: false, error: 'PENDING_CAP_REACHED' });
    expect(r.budgetLeft).toBe(4); // ← 没被扣
  });

  it('额度拦住的入队不占 pending cap', () => {
    // 额度必须在**队列还没判空**时耗尽 —— 否则「额度 0 + 队空」会直接收束,
    // 后面的入队就变成 NOT_PLAYING_PHASE 而不是 NO_BUDGET_LEFT。
    const r = playingRoom('twenty_questions', { budget: 2, pendingCap: 2 });
    ask(r, 'g1');
    ask(r, 'g1');
    expect(r.budgetLeft).toBe(0);
    expect(r.pendingCountOf('g1')).toBe(2);

    // cap 也满了,但先撞上的是哪一道闸不重要 —— 两道都不该扣额度
    expect(r.askQuestion('g1', 'q3', T0)).toEqual({ ok: false, error: 'PENDING_CAP_REACHED' });
    expect(r.budgetLeft).toBe(0);

    // 判掉一条:cap 空出名额,队列仍非空(不收束),额度仍是 0
    r.judge('oracle', 'YES', T0);
    expect(r.phase).toBe('playing');
    expect(r.pendingCountOf('g1')).toBe(1);
    expect(r.askQuestion('g1', 'q4', T0)).toEqual({ ok: false, error: 'NO_BUDGET_LEFT' });
  });

  it('海龟汤没有额度,但 pending cap 照样管用', () => {
    const r = playingRoom('situation', { pendingCap: 1 });
    ask(r, 'g1');
    expect(r.askQuestion('g1', 'again', T0)).toEqual({ ok: false, error: 'PENDING_CAP_REACHED' });
    expect(r.budgetLeft).toBeNull();
  });
});

/* ══════════════════════ FIFO + pending cap(必测 4)══════════════════════ */

describe('FIFO 队列', () => {
  it('严格判队首,不能挑', () => {
    const r = playingRoom('situation', { pendingCap: 3 });
    const q1 = ask(r, 'g1', '第一条');
    const q2 = ask(r, 'g2', '第二条');

    r.judge('oracle', 'YES', T0);
    expect(r.history.map((q) => q.id)).toEqual([q1.id]);
    expect(r.queue.map((q) => q.id)).toEqual([q2.id]);
  });

  it('队列空时判定被拒', () => {
    const r = playingRoom('situation');
    expect(r.judge('oracle', 'YES', T0)).toEqual({ ok: false, error: 'QUEUE_EMPTY' });
  });

  it('只有 oracle 能判', () => {
    const r = playingRoom('situation');
    ask(r, 'g1');
    expect(r.judge('g2', 'YES', T0)).toEqual({ ok: false, error: 'NOT_ORACLE' });
    expect(r.judge('host', 'YES', T0)).toEqual({ ok: false, error: 'NOT_ORACLE' });
  });

  it('**oracle 不能给自己提问**', () => {
    const r = playingRoom('situation');
    expect(r.askQuestion('oracle', 'q', T0)).toEqual({ ok: false, error: 'ORACLE_CANNOT_ASK' });
  });

  it('不在房里的人不能提问', () => {
    const r = playingRoom('situation');
    expect(r.askQuestion('nobody', 'q', T0)).toEqual({ ok: false, error: 'NOT_IN_ROOM' });
  });

  it('空白问题被拒', () => {
    const r = playingRoom('situation');
    expect(r.askQuestion('g1', '   ', T0)).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
  });

  it('中途加入的人可以立刻提问(co-op 随进随玩,SPEC §7)', () => {
    const r = playingRoom('situation');
    r.addPlayer('late', 'L', T0);
    expect(r.askQuestion('late', 'q', T0).ok).toBe(true);
  });
});

describe('per-player pending cap', () => {
  it('默认 1:自己有未判问题时不能再入队', () => {
    const r = playingRoom('situation');
    expect(r.settings.pendingCap).toBe(1);
    ask(r, 'g1');
    expect(r.askQuestion('g1', 'again', T0)).toEqual({ ok: false, error: 'PENDING_CAP_REACHED' });
  });

  it('cap 是 per-player 的 —— 别人不受影响', () => {
    const r = playingRoom('situation');
    ask(r, 'g1');
    expect(r.askQuestion('g2', 'q', T0).ok).toBe(true);
  });

  it('判掉之后名额就回来了', () => {
    const r = playingRoom('situation');
    ask(r, 'g1');
    r.judge('oracle', 'YES', T0);
    expect(r.askQuestion('g1', 'q2', T0).ok).toBe(true);
  });

  it('cap 可调到 3', () => {
    const r = playingRoom('situation', { pendingCap: 3 });
    ask(r, 'g1');
    ask(r, 'g1');
    ask(r, 'g1');
    expect(r.askQuestion('g1', 'q4', T0)).toEqual({ ok: false, error: 'PENDING_CAP_REACHED' });
  });

  it('pendingCountOf 只数未判的', () => {
    const r = playingRoom('situation', { pendingCap: 2 });
    ask(r, 'g1');
    ask(r, 'g1');
    expect(r.pendingCountOf('g1')).toBe(2);
    r.judge('oracle', 'YES', T0);
    expect(r.pendingCountOf('g1')).toBe(1);
  });
});

/* ══════════════════════ 判定 enum 按 config 表 ══════════════════════ */

describe('判定值必须来自 config 表(不判类型)', () => {
  it('20Q 收 YES / NO / UNCLEAR / CORRECT', () => {
    for (const a of ['YES', 'NO', 'UNCLEAR'] as const) {
      const r = playingRoom('twenty_questions', { budget: 20 });
      ask(r, 'g1');
      expect(r.judge('oracle', a, T0).ok).toBe(true);
    }
    const r = playingRoom('twenty_questions', { budget: 20 });
    ask(r, 'g1');
    expect(r.judge('oracle', 'CORRECT', T0).ok).toBe(true);
  });

  it('**20Q 不收 IRRELEVANT / BOTH** —— 表里没有', () => {
    for (const a of ['IRRELEVANT', 'BOTH'] as const) {
      const r = playingRoom('twenty_questions', { budget: 20 });
      ask(r, 'g1');
      expect(r.judge('oracle', a, T0)).toEqual({ ok: false, error: 'ANSWER_NOT_ALLOWED' });
    }
  });

  it('海龟汤收 YES / NO / IRRELEVANT / BOTH', () => {
    for (const a of ['YES', 'NO', 'IRRELEVANT', 'BOTH'] as const) {
      const r = playingRoom('situation');
      ask(r, 'g1');
      expect(r.judge('oracle', a, T0).ok).toBe(true);
    }
  });

  it('**海龟汤不收 CORRECT / UNCLEAR** —— 它靠还原提交收束,不靠判定', () => {
    for (const a of ['CORRECT', 'UNCLEAR'] as const) {
      const r = playingRoom('situation');
      ask(r, 'g1');
      expect(r.judge('oracle', a, T0)).toEqual({ ok: false, error: 'ANSWER_NOT_ALLOWED' });
    }
  });

  it('乱传的值被拒', () => {
    const r = playingRoom('situation');
    ask(r, 'g1');
    expect(r.judge('oracle', 'MAYBE' as never, T0)).toEqual({
      ok: false,
      error: 'ANSWER_NOT_ALLOWED',
    });
  });
});

/* ══════════════════════════ 判定改错 ══════════════════════════ */

describe('判定改错:仅最近一条,仅一次', () => {
  it('能改最近一条', () => {
    const r = playingRoom('situation');
    const q = ask(r, 'g1');
    r.judge('oracle', 'YES', T0);

    expect(r.correctLast('oracle', 'NO', T0).ok).toBe(true);
    const judged = r.history.find((h) => h.id === q.id)!;
    expect(judged.answer).toBe('NO');
    expect(judged.previousAnswer).toBe('YES');
    expect(judged.corrected).toBe(true);
  });

  it('**只能改一次** —— 防翻旧账搅乱推理链', () => {
    const r = playingRoom('situation');
    ask(r, 'g1');
    r.judge('oracle', 'YES', T0);
    r.correctLast('oracle', 'NO', T0);
    expect(r.correctLast('oracle', 'BOTH', T0)).toEqual({
      ok: false,
      error: 'ALREADY_CORRECTED',
    });
  });

  it('**只能改最近一条** —— 判了新的,旧的就锁死了', () => {
    const r = playingRoom('situation', { pendingCap: 2 });
    const q1 = ask(r, 'g1');
    ask(r, 'g2');
    r.judge('oracle', 'YES', T0);
    r.judge('oracle', 'NO', T0);

    r.correctLast('oracle', 'BOTH', T0);
    expect(r.history.find((h) => h.id === q1.id)!.answer).toBe('YES'); // 第一条没被动
    expect(r.history[1]!.answer).toBe('BOTH');
  });

  it('没判过任何东西时不能改', () => {
    const r = playingRoom('situation');
    expect(r.correctLast('oracle', 'YES', T0)).toEqual({ ok: false, error: 'NOTHING_TO_CORRECT' });
  });

  it('只有 oracle 能改', () => {
    const r = playingRoom('situation');
    ask(r, 'g1');
    r.judge('oracle', 'YES', T0);
    expect(r.correctLast('g1', 'NO', T0)).toEqual({ ok: false, error: 'NOT_ORACLE' });
  });

  it('改错也受 config 表约束', () => {
    const r = playingRoom('situation');
    ask(r, 'g1');
    r.judge('oracle', 'YES', T0);
    expect(r.correctLast('oracle', 'CORRECT', T0)).toEqual({
      ok: false,
      error: 'ANSWER_NOT_ALLOWED',
    });
  });

  it('**改成 CORRECT 一样收束** —— 改错不是绕过收束的后门', () => {
    const r = playingRoom('twenty_questions', { budget: 20 });
    ask(r, 'g1');
    r.judge('oracle', 'NO', T0);
    expect(r.phase).toBe('playing');

    r.correctLast('oracle', 'CORRECT', T0);
    expect(r.phase).toBe('reveal');
    expect(r.outcome).toMatchObject({ result: 'hit', winnerId: 'g1' });
  });

  it('改错不动额度(额度在入队时就扣完了)', () => {
    const r = playingRoom('twenty_questions', { budget: 5 });
    ask(r, 'g1');
    r.judge('oracle', 'UNCLEAR', T0);
    expect(r.budgetLeft).toBe(4);
    r.correctLast('oracle', 'YES', T0);
    expect(r.budgetLeft).toBe(4);
  });
});

/* ══════════════════════ 海龟汤:还原提交通道 ══════════════════════ */

describe('还原提交(guessMode = submission)', () => {
  it('**20Q 没有这条通道**', () => {
    const r = playingRoom('twenty_questions', { budget: 20 });
    expect(r.submitSolution('g1', '答案是长颈鹿', T0)).toEqual({
      ok: false,
      error: 'SUBMISSION_NOT_AVAILABLE',
    });
  });

  it('海龟汤可以提交', () => {
    const r = playingRoom('situation');
    const s = r.submitSolution('g1', '他吃的是同伴的肉', T0);
    expect(s.ok).toBe(true);
    expect(r.submissions).toHaveLength(1);
  });

  it('**不占 pending cap** —— 手上有未判问题也能交还原', () => {
    const r = playingRoom('situation', { pendingCap: 1 });
    ask(r, 'g1');
    expect(r.pendingCountOf('g1')).toBe(1);
    expect(r.submitSolution('g1', '还原', T0).ok).toBe(true);
    expect(r.pendingCountOf('g1')).toBe(1); // 还是 1,还原没算进去
  });

  it('**每人同时最多 1 条未决还原**', () => {
    const r = playingRoom('situation');
    r.submitSolution('g1', '第一版', T0);
    expect(r.submitSolution('g1', '第二版', T0)).toEqual({
      ok: false,
      error: 'SUBMISSION_PENDING',
    });
    expect(r.submitSolution('g2', '别人的', T0).ok).toBe(true);
  });

  it('被 reject 之后可以再交', () => {
    const r = playingRoom('situation');
    const s = r.submitSolution('g1', '第一版', T0);
    if (!s.ok) throw new Error('submit failed');
    r.resolveSubmission('oracle', s.value.id, false, T0);
    expect(r.submitSolution('g1', '第二版', T0).ok).toBe(true);
  });

  it('**accept → 命中收束,提交者记为命中者**', () => {
    const r = playingRoom('situation');
    const s = r.submitSolution('g2', '他吃的是同伴的肉', T0);
    if (!s.ok) throw new Error('submit failed');

    r.resolveSubmission('oracle', s.value.id, true, T0 + 30_000);
    expect(r.phase).toBe('reveal');
    expect(r.outcome).toMatchObject({ result: 'hit', winnerId: 'g2' });
    expect(r.outcome!.truth).toBe('SECRET_TRUTH');
  });

  it('**reject → 继续,无任何消耗**', () => {
    const r = playingRoom('situation');
    const s = r.submitSolution('g1', '猜错的', T0);
    if (!s.ok) throw new Error('submit failed');

    r.resolveSubmission('oracle', s.value.id, false, T0);
    expect(r.phase).toBe('playing');
    expect(r.outcome).toBeNull();
    expect(r.budgetLeft).toBeNull();
    expect(r.pendingCountOf('g1')).toBe(0);
    expect(r.submissions.find((x) => x.id === s.value.id)!.status).toBe('rejected');
  });

  it('只有 oracle 能处理还原', () => {
    const r = playingRoom('situation');
    const s = r.submitSolution('g1', 'x', T0);
    if (!s.ok) throw new Error('submit failed');
    expect(r.resolveSubmission('g2', s.value.id, true, T0)).toEqual({
      ok: false,
      error: 'NOT_ORACLE',
    });
  });

  it('处理不存在的还原被拒', () => {
    const r = playingRoom('situation');
    expect(r.resolveSubmission('oracle', 'nope', true, T0)).toEqual({
      ok: false,
      error: 'SUBMISSION_NOT_FOUND',
    });
  });

  it('还原内容**全房可见**(co-op 无泄题问题)', () => {
    const r = playingRoom('situation');
    r.submitSolution('g1', '他吃的是同伴的肉', T0);
    for (const viewer of ['oracle', 'g1', 'g2', 'host']) {
      const state = r.toClientState(viewer);
      expect(JSON.stringify(state.submissions)).toContain('他吃的是同伴的肉');
    }
  });

  it('oracle 不能提交还原', () => {
    const r = playingRoom('situation');
    expect(r.submitSolution('oracle', 'x', T0)).toEqual({ ok: false, error: 'ORACLE_CANNOT_ASK' });
  });
});

/* ══════════════════ 海龟汤:oracle 公开汤底 · 结束本局 ══════════════════ */

describe('公开汤底 · 结束本局', () => {
  it('oracle 可以主动公开 → 记为未猜中', () => {
    const r = playingRoom('situation');
    ask(r, 'g1');
    r.judge('oracle', 'YES', T0);

    expect(r.revealTruth('oracle', T0 + 10_000).ok).toBe(true);
    expect(r.phase).toBe('reveal');
    expect(r.outcome).toMatchObject({ result: 'revealed', winnerId: null });
    expect(r.outcome!.truth).toBe('SECRET_TRUTH');
  });

  it('只有 oracle 能公开', () => {
    const r = playingRoom('situation');
    expect(r.revealTruth('host', T0)).toEqual({ ok: false, error: 'NOT_ORACLE' });
    expect(r.revealTruth('g1', T0)).toEqual({ ok: false, error: 'NOT_ORACLE' });
  });

  it('20Q 也能用(额度没耗完但想收摊)', () => {
    const r = playingRoom('twenty_questions', { budget: 20 });
    expect(r.revealTruth('oracle', T0).ok).toBe(true);
    expect(r.outcome!.result).toBe('revealed');
  });

  it('不在 playing 就不能公开', () => {
    const r = playingRoom('situation');
    r.revealTruth('oracle', T0);
    expect(r.revealTruth('oracle', T0)).toEqual({ ok: false, error: 'NOT_PLAYING_PHASE' });
  });
});

/* ══════════════════════ 归位:第二局不许带脏状态 ══════════════════════ */

describe('resetForNextRound —— 第二局不得带上一局的任何东西', () => {
  function finishedRoom() {
    const r = playingRoom('situation', { pendingCap: 2 });
    ask(r, 'g1');
    ask(r, 'g2');
    r.judge('oracle', 'YES', T0);
    r.submitSolution('g1', '一个还原', T0);
    r.revealTruth('oracle', T0);
    return r;
  }

  it('收束之后这些东西确实还在(reveal 屏要用)', () => {
    const r = finishedRoom();
    expect(r.puzzle).not.toBeNull();
    expect(r.history.length).toBeGreaterThan(0);
    expect(r.outcome).not.toBeNull();
  });

  it('**归位后:题、队列、历史、还原、额度、outcome 全部清空**', () => {
    const r = finishedRoom();
    r.resetForNextRound(T0);

    expect(r.puzzle).toBeNull();
    expect(r.queue).toEqual([]);
    expect(r.history).toEqual([]);
    expect(r.submissions).toEqual([]);
    expect(r.budgetLeft).toBeNull();
    expect(r.outcome).toBeNull();
  });

  it('**已用题 Set 不清** —— 同一晚不该重复出同一道题', () => {
    const r = finishedRoom();
    expect(r.usedPuzzleIds.has('p1')).toBe(true);
    r.resetForNextRound(T0);
    expect(r.usedPuzzleIds.has('p1')).toBe(true);
  });

  it('归位不动座位与房间层状态', () => {
    const r = finishedRoom();
    r.resetForNextRound(T0);
    expect(r.oracleId).toBe('oracle');
    expect(r.hostId).toBe('host');
    expect(r.players).toHaveLength(4);
  });

  it('reveal → setup 会自动归位,第二局开局时是干净的', () => {
    const r = finishedRoom();
    expect(r.startNextRound('host', T0).ok).toBe(true);
    expect(r.phase).toBe('setup');
    expect(r.puzzle).toBeNull();
    expect(r.history).toEqual([]);
    expect(r.outcome).toBeNull();
  });

  it('reveal → lobby 同样归位', () => {
    const r = finishedRoom();
    expect(r.backToLobby('host', T0).ok).toBe(true);
    expect(r.phase).toBe('lobby');
    expect(r.puzzle).toBeNull();
    expect(r.queue).toEqual([]);
    expect(r.outcome).toBeNull();
  });

  it('**第二局重新拿到满额度**,不是接着上一局的余额', () => {
    const r = playingRoom('twenty_questions', { budget: 3 });
    ask(r, 'g1');
    ask(r, 'g2');
    expect(r.budgetLeft).toBe(1);
    r.revealTruth('oracle', T0);

    r.startNextRound('host', T0);
    r.setCustomPuzzle('oracle', { truth: '第二局' }, T0);
    r.beginPlaying('oracle', T0);
    expect(r.budgetLeft).toBe(3); // ← 不是 1
  });

  it('非 host 不能开下一局 / 回 lobby', () => {
    const r = finishedRoom();
    expect(r.startNextRound('g1', T0)).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(r.backToLobby('g1', T0)).toEqual({ ok: false, error: 'NOT_HOST' });
  });
});

/* ══════════════════════════ 遮蔽仍然成立 ══════════════════════════ */

describe('判定循环期间,遮蔽不能松', () => {
  it('playing 期间 guesser 仍看不到汤底', () => {
    const r = playingRoom('situation');
    ask(r, 'g1');
    r.judge('oracle', 'YES', T0);
    for (const viewer of ['g1', 'g2', 'host']) {
      expect(JSON.stringify(r.toClientState(viewer))).not.toContain('SECRET_TRUTH');
    }
    expect(r.toClientState('oracle').oracleTruth).toBe('SECRET_TRUTH');
  });

  it('队列与历史**全房可见**(共享问答流,co-op 无信息差)', () => {
    const r = playingRoom('situation', { pendingCap: 2 });
    ask(r, 'g1', '他是人类吗');
    ask(r, 'g2', '和天气有关吗');
    r.judge('oracle', 'YES', T0);

    for (const viewer of ['g1', 'g2', 'host', 'oracle']) {
      const st = r.toClientState(viewer);
      expect(st.history).toHaveLength(1);
      expect(st.queue).toHaveLength(1);
      expect(JSON.stringify(st)).toContain('他是人类吗');
      expect(JSON.stringify(st)).toContain('和天气有关吗');
    }
  });

  it('额度对全房可见(它是共享资源)', () => {
    const r = playingRoom('twenty_questions', { budget: 20 });
    ask(r, 'g1');
    for (const viewer of ['g1', 'oracle', 'host']) {
      expect(r.toClientState(viewer).budgetLeft).toBe(19);
    }
  });

  it('**收束后真相才对全房公开**', () => {
    const r = playingRoom('situation');
    expect(r.toClientState('g1').outcome).toBeNull();

    r.revealTruth('oracle', T0);
    const st = r.toClientState('g1');
    expect(st.outcome!.truth).toBe('SECRET_TRUTH'); // reveal 了才给
  });
});
