/**
 * LobbyBroadcaster —— 通用面 #8 的四条规则。
 *
 * build/emit 是注入的,所以这里**完全不需要 socket**。
 * 这也是照抄时最容易做错的一个:规则 3(去重)比规则 2(合并)要紧,
 * 而规则 4 的「不更新 dedupe 缓存」在 platform-docs 里根本没写(NOTES 偏差 #7)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LobbyBroadcaster } from './LobbyBroadcaster';

interface Row {
  code: string;
}

function make(initial: Row[] = []) {
  let rows = initial;
  const emitted: Row[][] = [];
  const b = new LobbyBroadcaster<Row>(
    () => rows,
    (r) => emitted.push(r),
    { windowMs: 50 },
  );
  return {
    b,
    emitted,
    set: (r: Row[]) => {
      rows = r;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('规则 2 — coalesce', () => {
  it('窗口内的多次 schedule 只产生一次 emit', () => {
    const { b, emitted, set } = make([]);
    set([{ code: 'a' }]);

    b.schedule();
    b.schedule();
    b.schedule();
    expect(emitted).toHaveLength(0); // 还没到点

    vi.advanceTimersByTime(50);
    expect(emitted).toHaveLength(1); // ← idle sweep 掉 4 个房 = 1 次 emit,不是 4 次
  });

  it('窗口结束后再 schedule 会开新窗口', () => {
    const { b, emitted, set } = make([]);
    set([{ code: 'a' }]);
    b.schedule();
    vi.advanceTimersByTime(50);

    set([{ code: 'a' }, { code: 'b' }]);
    b.schedule();
    vi.advanceTimersByTime(50);

    expect(emitted).toHaveLength(2);
  });
});

describe('规则 3 — dedupe(比 debounce 更要紧)', () => {
  it('**内容没变就不发** —— 闲着的 lobby 客户端不该被看不见的流量吵醒', () => {
    const { b, emitted, set } = make([]);
    set([{ code: 'a' }]);
    b.schedule();
    vi.advanceTimersByTime(50);
    expect(emitted).toHaveLength(1);

    // 模拟局内每一步 mutation:choke point 都会 schedule,但列表行没变
    for (let i = 0; i < 20; i++) {
      b.schedule();
      vi.advanceTimersByTime(50);
    }
    expect(emitted).toHaveLength(1); // ← 一次都没多发
  });

  it('内容真变了就发', () => {
    const { b, emitted, set } = make([]);
    set([{ code: 'a' }]);
    b.schedule();
    vi.advanceTimersByTime(50);

    set([{ code: 'a' }, { code: 'b' }]);
    b.schedule();
    vi.advanceTimersByTime(50);

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual([{ code: 'a' }, { code: 'b' }]);
  });

  it('一个房间在同一个窗口里出现又消失 → 根本不会被公告', () => {
    const { b, emitted, set } = make([]);
    // 先把「当前是空列表」这个事实发出去,让 dedupe 有基线可比。
    b.schedule();
    vi.advanceTimersByTime(50);
    expect(emitted).toEqual([[]]);

    set([{ code: 'ghost' }]);
    b.schedule();
    set([]); // 同一个窗口内又没了
    vi.advanceTimersByTime(50);

    // 窗口结算时列表和上次一样 → 不发。ghost 从未被公告过。
    expect(emitted).toHaveLength(1);
    expect(JSON.stringify(emitted)).not.toContain('ghost');
  });
});

describe('规则 4 — 新订阅者绕过前两条', () => {
  it('current() 立即返回,不受窗口影响', () => {
    const { b, set } = make([]);
    set([{ code: 'a' }]);
    expect(b.current()).toEqual([{ code: 'a' }]);
  });

  it('**current() 不能污染 dedupe 缓存** —— 否则下一次真实变化会被吞掉', () => {
    const { b, emitted, set } = make([]);
    set([{ code: 'a' }]);

    b.current(); // 新订阅者拿快照
    b.schedule(); // 随后广播这同一份内容
    vi.advanceTimersByTime(50);

    // 若 current() 顺手写了 lastSerialized,这里就会是 0 —— 别人永远收不到这次变化
    expect(emitted).toHaveLength(1);
  });
});

describe('排序前提', () => {
  it('build 必须给出稳定顺序,否则去重会把顺序变化误判成内容变化', () => {
    const { b, emitted, set } = make([]);
    set([{ code: 'a' }, { code: 'b' }]);
    b.schedule();
    vi.advanceTimersByTime(50);

    set([{ code: 'b' }, { code: 'a' }]); // 同样两间房,顺序不同
    b.schedule();
    vi.advanceTimersByTime(50);

    // 去重是按序列化比的 —— 顺序变了就会多发一次。
    // 这条测试是在**钉住这个前提**:buildLobbyList 必须排序(它排了)。
    expect(emitted).toHaveLength(2);
  });
});

describe('生命周期', () => {
  it('dispose 之后待发的窗口不再触发', () => {
    const { b, emitted, set } = make([]);
    set([{ code: 'a' }]);
    b.schedule();
    b.dispose();
    vi.advanceTimersByTime(200);
    expect(emitted).toHaveLength(0);
  });

  it('flushNow 立刻结算', () => {
    const { b, emitted, set } = make([]);
    set([{ code: 'a' }]);
    b.schedule();
    b.flushNow();
    expect(emitted).toHaveLength(1);
  });
});
