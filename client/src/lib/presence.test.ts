/**
 * 幽灵房间对账的回归测试。
 *
 * 场景本身来自本地 smoke:重启 server → client 自动重连 → 认领成功,
 * 但房间已经不在了。旧行为是**留在死屏上反复报「你不在房间里」**。
 *
 * 纯函数,全同步,CI 稳定。
 */

import { describe, expect, it } from 'vitest';
import { reconcilePresence } from './presence';

describe('reconcilePresence', () => {
  it('本来就没在房里 —— 无事发生,也不打扰用户', () => {
    expect(reconcilePresence({ localCode: null, serverCode: null })).toEqual({
      clearRoom: false,
      notice: null,
    });
  });

  it('对得上 —— 正常重连,继续玩', () => {
    expect(reconcilePresence({ localCode: '1234', serverCode: '1234' })).toEqual({
      clearRoom: false,
      notice: null,
    });
  });

  it('**本地以为在、server 说不在 → 退回 landing 并明说**', () => {
    expect(reconcilePresence({ localCode: '1234', serverCode: null })).toEqual({
      clearRoom: true,
      notice: 'ROOM_GONE',
    });
  });

  it('本地记的和 server 说的不是同一间 → 也退回(宁可退,别错屏)', () => {
    expect(reconcilePresence({ localCode: '1234', serverCode: '9999' })).toEqual({
      clearRoom: true,
      notice: 'ROOM_GONE',
    });
  });

  it('**没在房里的人不会被无端提示** —— server 说 null 且本地也是 null', () => {
    const d = reconcilePresence({ localCode: null, serverCode: null });
    expect(d.notice).toBeNull();
  });

  it('server 说「你在某个房间」而本地空着 —— 不清,交给 room_state 补齐', () => {
    // 这条路径本来就会收到 s:room_state,不需要在这里做任何事。
    expect(reconcilePresence({ localCode: null, serverCode: '1234' })).toEqual({
      clearRoom: false,
      notice: null,
    });
  });
});
