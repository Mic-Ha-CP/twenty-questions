/**
 * Socket 层 —— 事件接线 + **房间状态 mutation 的唯一 choke point**。
 *
 * LOBBY-PATTERN 的前置条件:「A game without a mutation choke point should build
 * that first. It is worth more than the lobby feature itself.」
 * 这里就是那个 choke point:`commit(room)`。**每一个改动房间的 handler 都必须调它,
 * 且只调它** —— 广播和 lobby 调度是它的事,不是 handler 的事。
 *
 * SPEC §8:server 只发语义 enum / key,**永不发展示字符串**。
 * 本文件里搜不到任何一个中文展示串 —— 拒绝一律是 `{ code: ErrorCode }`。
 */

import type { Server, Socket } from 'socket.io';
import { C2S, S2C, type ErrorCode, type Result } from '@shared/events';
import { normalizeDisplayName } from '@shared/names';
import type { Answer } from '@shared/puzzleTypes';
import type { PlayerId, RoomSettings, RoomSummary } from '@shared/types';
import { findPuzzle, listAvailable, suggestAnswerWord } from '../game/puzzleBank';
import { LobbyBroadcaster } from '../room/LobbyBroadcaster';
import type { BankPort, Room } from '../room/Room';
import { RoomManager } from '../room/RoomManager';

const LOBBY_CHANNEL = 'lobby';
const roomChannel = (code: string) => `room:${code}`;

interface SocketData {
  playerId?: PlayerId;
  nickname?: string;
}

/** 题库端口的真实实现 —— 唯一把 data/ 接进 Room 的地方。 */
const BANK: BankPort = { list: listAvailable, find: findPuzzle };

export function attachSocketLayer(io: Server): { manager: RoomManager; dispose: () => void } {
  const manager = new RoomManager(() => Date.now(), BANK);

  /** playerId → socket。per-viewer 投影要按人发,不能用频道广播一把梭。 */
  const sockets = new Map<PlayerId, Socket>();

  const lobby = new LobbyBroadcaster<RoomSummary>(
    () => buildLobbyList(manager),
    (rooms) => io.to(LOBBY_CHANNEL).emit(S2C.LOBBY_LIST, { rooms }),
  );

  /* ══════════════════════ THE CHOKE POINT ══════════════════════ */

  /**
   * 房间被改动之后**唯一**该调的东西。
   * 覆盖 join / leave / kick / ready / settings / 座位 / phase / 断线。
   */
  function commit(room: Room): void {
    broadcastRoomState(room);
    lobby.schedule();
  }

  /** per-viewer 投影:每个人拿到的是**给 ta 看的**那一份。 */
  function broadcastRoomState(room: Room): void {
    for (const player of room.players) {
      const s = sockets.get(player.id);
      if (s) s.emit(S2C.ROOM_STATE, room.toClientState(player.id));
    }
  }

  // 通用面 #2:idle sweep 是唯一从外面观察不到的退出路径,必须挂回调。
  manager.onRoomRemoved((room) => {
    io.to(roomChannel(room.code)).emit(S2C.ROOM_CLOSED, {});
    lobby.schedule();
  });
  manager.startSweep((room) => commit(room));

  /* ═══════════════════════ connection ═══════════════════════ */

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;

    const fail = (code: ErrorCode) => socket.emit(S2C.ERROR, { code });

    /** 拿到调用者的 playerId + 所在房间,拿不到就发错误码。 */
    function actor(): { playerId: PlayerId; room: Room } | null {
      const playerId = data.playerId;
      if (!playerId) {
        fail('INVALID_PAYLOAD');
        return null;
      }
      const room = manager.byPlayer(playerId);
      if (!room) {
        fail('NOT_IN_ROOM');
        return null;
      }
      return { playerId, room };
    }

    /** 把 Result 收口成「成功就 commit,失败就发错误码」。 */
    function settle(room: Room, r: Result<unknown>): void {
      if (!r.ok) {
        fail(r.error);
        return;
      }
      commit(room);
    }

    /* ── 身份:localStorage 里的稳定 playerId 在这里认领 ── */
    socket.on(C2S.HELLO, (payload: unknown) => {
      const p = payload as { playerId?: unknown; nickname?: unknown } | null;
      const playerId = typeof p?.playerId === 'string' ? p.playerId : null;
      if (!playerId) return fail('INVALID_PAYLOAD');

      data.playerId = playerId;
      data.nickname = normalizeDisplayName(p?.nickname) ?? '';
      sockets.set(playerId, socket);

      const room = manager.byPlayer(playerId);
      /*
       * **认领的回执要带上「你现在在哪个房间」。**
       * server 重启后 client 会自动重连、认领也会成功,但它记着的房间已经随进程
       * 蒸发(ADR-12 零持久化)。不明说的话 client 会留在死屏上,点一下收一条
       * 「你不在房间里」—— 用户看到的是界面永远不动。
       * 这里给出事实(`code` 或 `null`),让 client 自己退回 landing。
       */
      socket.emit(S2C.HELLO_OK, { playerId, roomCode: room?.code ?? null });

      // 断线重连:playerId 还在某个房间里 → 重新绑上去,不当新人处理(SPEC §7)。
      if (room) {
        socket.leave(LOBBY_CHANNEL);
        socket.join(roomChannel(room.code));
        room.addPlayer(playerId, data.nickname || '', Date.now());
        commit(room);
      }
    });

    /* ── lobby 频道 ── */
    socket.on(C2S.LOBBY_SUBSCRIBE, () => {
      socket.join(LOBBY_CHANNEL);
      // 规则 4:刚订阅的人绕过合并与去重,总是拿到一份快照。
      socket.emit(S2C.LOBBY_LIST, { rooms: lobby.current() });
    });

    socket.on(C2S.LOBBY_UNSUBSCRIBE, () => socket.leave(LOBBY_CHANNEL));

    /* ── 建房 / 加入 / 离开 ── */
    socket.on(C2S.CREATE_ROOM, (payload: unknown) => {
      const playerId = data.playerId;
      if (!playerId) return fail('INVALID_PAYLOAD');
      if (manager.byPlayer(playerId)) return fail('INVALID_PAYLOAD');

      const p = payload as { isPrivate?: unknown } | null;
      // create-then-modify 竞态:isPrivate **建房那一刻**就定死,不是先建公开再改。
      const isPrivate = p?.isPrivate === true;

      const created = manager.create({ id: playerId, nickname: data.nickname || '' }, isPrivate);
      if (!created.ok) return fail(created.error);

      socket.leave(LOBBY_CHANNEL);
      socket.join(roomChannel(created.value.code));
      commit(created.value);
    });

    socket.on(C2S.JOIN_ROOM, (payload: unknown) => {
      const playerId = data.playerId;
      if (!playerId) return fail('INVALID_PAYLOAD');

      const p = payload as { code?: unknown } | null;
      if (typeof p?.code !== 'string') return fail('INVALID_PAYLOAD');

      const room = manager.byCode(p.code);
      if (!room) return fail('ROOM_NOT_FOUND');

      const added = room.addPlayer(playerId, data.nickname || '', Date.now());
      if (!added.ok) return fail(added.error);

      socket.leave(LOBBY_CHANNEL);
      socket.join(roomChannel(room.code));
      commit(room);
    });

    socket.on(C2S.LEAVE_ROOM, () => {
      const a = actor();
      if (!a) return;
      a.room.removePlayer(a.playerId, Date.now());
      socket.leave(roomChannel(a.room.code));
      if (!manager.removeIfDeserted(a.room)) commit(a.room);
      else lobby.schedule();
    });

    /* ── 房间层设置 ── */
    socket.on(C2S.SET_READY, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const ready = (payload as { ready?: unknown } | null)?.ready === true;
      settle(a.room, a.room.setReady(a.playerId, ready, Date.now()));
    });

    socket.on(C2S.SET_NICKNAME, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const name = normalizeDisplayName((payload as { nickname?: unknown } | null)?.nickname);
      if (name === null) return fail('INVALID_PAYLOAD');
      data.nickname = name;
      settle(a.room, a.room.setNickname(a.playerId, name, Date.now()));
    });

    socket.on(C2S.UPDATE_SETTINGS, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const patch = (payload ?? {}) as Partial<RoomSettings>;
      const r = a.room.updateSettings(a.playerId, patch, Date.now());
      if (!r.ok) return fail(r.error);
      manager.syncPrivacy(a.room); // 公私切换 → 发号 / 收号
      commit(a.room);
    });

    socket.on(C2S.KICK_PLAYER, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const targetId = (payload as { playerId?: unknown } | null)?.playerId;
      if (typeof targetId !== 'string') return fail('INVALID_PAYLOAD');

      const r = a.room.kickPlayer(a.playerId, targetId, Date.now());
      if (!r.ok) return fail(r.error);

      const victim = sockets.get(targetId);
      if (victim) {
        victim.emit(S2C.KICKED, {});
        victim.leave(roomChannel(a.room.code));
      }
      commit(a.room);
    });

    socket.on(C2S.TRANSFER_HOST, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const targetId = (payload as { playerId?: unknown } | null)?.playerId;
      if (typeof targetId !== 'string') return fail('INVALID_PAYLOAD');
      settle(a.room, a.room.transferHost(a.playerId, targetId, Date.now()));
    });

    /* ── oracle 座位(SPEC §2)── */
    socket.on(C2S.CLAIM_ORACLE, () => {
      const a = actor();
      if (!a) return;
      // 同步处理 = 先到先得。后到者收 SEAT_TAKEN,client 等广播才渲染。
      settle(a.room, a.room.claimOracle(a.playerId, Date.now()));
    });

    socket.on(C2S.RELEASE_ORACLE, () => {
      const a = actor();
      if (!a) return;
      settle(a.room, a.room.releaseOracle(a.playerId, Date.now()));
    });

    socket.on(C2S.ASSIGN_ORACLE, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const raw = (payload as { playerId?: unknown } | null)?.playerId;
      const targetId = raw === null ? null : typeof raw === 'string' ? raw : undefined;
      if (targetId === undefined) return fail('INVALID_PAYLOAD');

      const from = a.room.oracleId;
      const r = a.room.assignOracle(a.playerId, targetId, Date.now());
      if (!r.ok) return fail(r.error);

      // 局中换判定的人是件大事 —— 发个独立事件,别让它埋在 room_state 的差异里。
      if (from !== a.room.oracleId) {
        io.to(roomChannel(a.room.code)).emit(S2C.ORACLE_TRANSFERRED, {
          from,
          to: a.room.oracleId,
        });
      }
      commit(a.room);
    });

    /** 改**下一局**的出题人(reveal 专用,和上面的中段接管不是一回事)。 */
    socket.on(C2S.SET_NEXT_ORACLE, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const raw = (payload as { playerId?: unknown } | null)?.playerId;
      const targetId = raw === null ? null : typeof raw === 'string' ? raw : undefined;
      if (targetId === undefined) return fail('INVALID_PAYLOAD');
      settle(a.room, a.room.setNextOracle(a.playerId, targetId, Date.now()));
    });

    /* ── phase ── */
    socket.on(C2S.START_GAME, () => {
      const a = actor();
      if (!a) return;
      settle(a.room, a.room.startGame(a.playerId, Date.now()));
    });

    /* ── setup:录题(SPEC §6)。全部 oracle-only,守卫在 Room 里 ── */
    socket.on(C2S.SELECT_BANK_PUZZLE, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const id = (payload as { puzzleId?: unknown } | null)?.puzzleId;
      if (typeof id !== 'string') return fail('INVALID_PAYLOAD');
      settle(a.room, a.room.selectBankPuzzle(a.playerId, id, Date.now()));
    });

    socket.on(C2S.SET_CUSTOM_PUZZLE, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const p = (payload ?? {}) as { surface?: unknown; truth?: unknown; title?: unknown };
      settle(
        a.room,
        a.room.setCustomPuzzle(
          a.playerId,
          {
            surface: typeof p.surface === 'string' ? p.surface : null,
            truth: p.truth,
            title: typeof p.title === 'string' ? p.title : null,
          },
          Date.now(),
        ),
      );
    });

    socket.on(C2S.CLEAR_PUZZLE, () => {
      const a = actor();
      if (!a) return;
      settle(a.room, a.room.clearPuzzle(a.playerId, Date.now()));
    });

    socket.on(C2S.BEGIN_PLAYING, () => {
      const a = actor();
      if (!a) return;
      settle(a.room, a.room.beginPlaying(a.playerId, Date.now()));
    });

    /**
     * 20Q 的随机建议词。**点对点回给 oracle,不广播** —— 广播就等于把候选词
     * 发给了所有 guesser。这不是房间状态,所以不走 commit()。
     */
    /* ── playing:判定循环(SPEC §5)。守卫全在 Room 里 ── */
    socket.on(C2S.ASK_QUESTION, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      settle(a.room, a.room.askQuestion(a.playerId, (payload as { text?: unknown })?.text, Date.now()));
    });

    socket.on(C2S.JUDGE, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const answer = (payload as { answer?: unknown } | null)?.answer;
      if (typeof answer !== 'string') return fail('INVALID_PAYLOAD');
      settle(a.room, a.room.judge(a.playerId, answer as Answer, Date.now()));
    });

    socket.on(C2S.CORRECT_LAST, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const answer = (payload as { answer?: unknown } | null)?.answer;
      if (typeof answer !== 'string') return fail('INVALID_PAYLOAD');

      const before = a.room.history[a.room.history.length - 1];
      const previousAnswer = before?.answer ?? null;

      const r = a.room.correctLast(a.playerId, answer as Answer, Date.now());
      if (!r.ok) return fail(r.error);

      // 独立的更正事件:光靠 room_state 里的 corrected 标记,client 没法就地提示
      // 「刚才那条改判了」—— 推理链被悄悄改写是这条规则最怕的事。**只发语义。**
      io.to(roomChannel(a.room.code)).emit(S2C.JUDGEMENT_CORRECTED, {
        questionId: r.value.id,
        from: previousAnswer,
        to: r.value.answer,
      });
      commit(a.room);
    });

    socket.on(C2S.SUBMIT_SOLUTION, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      settle(
        a.room,
        a.room.submitSolution(a.playerId, (payload as { text?: unknown })?.text, Date.now()),
      );
    });

    socket.on(C2S.RESOLVE_SUBMISSION, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      const p = (payload ?? {}) as { submissionId?: unknown; accept?: unknown };
      if (typeof p.submissionId !== 'string') return fail('INVALID_PAYLOAD');
      settle(
        a.room,
        a.room.resolveSubmission(a.playerId, p.submissionId, p.accept === true, Date.now()),
      );
    });

    socket.on(C2S.REVEAL_TRUTH, () => {
      const a = actor();
      if (!a) return;
      // 确认弹窗是 client 的责任(SPEC §5 防误触);server 只管执行。
      settle(a.room, a.room.revealTruth(a.playerId, Date.now()));
    });

    /* ── reveal 出口:两条边都归位,第二局不带脏状态 ── */
    socket.on(C2S.START_NEXT_ROUND, () => {
      const a = actor();
      if (!a) return;
      settle(a.room, a.room.startNextRound(a.playerId, Date.now()));
    });

    socket.on(C2S.BACK_TO_LOBBY, () => {
      const a = actor();
      if (!a) return;
      settle(a.room, a.room.backToLobby(a.playerId, Date.now()));
    });

    socket.on(C2S.SUGGEST_ANSWER_WORD, (payload: unknown) => {
      const a = actor();
      if (!a) return;
      if (!a.room.isOracle(a.playerId)) return fail('NOT_ORACLE');
      if (a.room.phase !== 'setup') return fail('NOT_SETUP_PHASE');
      const exclude = (payload as { exclude?: unknown } | null)?.exclude;
      socket.emit(S2C.ANSWER_WORD_SUGGESTION, {
        word: suggestAnswerWord(typeof exclude === 'string' ? exclude : undefined),
      });
    });

    /* ── 断线:标记不移除,等宽限(SPEC §7)── */
    socket.on('disconnect', () => {
      const playerId = data.playerId;
      if (!playerId) return;
      // 只在这个 socket 仍是该 playerId 的当前 socket 时清 —— 否则会把刚重连的踢掉。
      if (sockets.get(playerId) === socket) sockets.delete(playerId);

      const room = manager.byPlayer(playerId);
      if (!room) return;
      room.markDisconnected(playerId, Date.now());
      commit(room);
    });
  });

  return {
    manager,
    dispose: () => {
      manager.stopSweep();
      lobby.dispose();
    },
  };
}

/**
 * 投影是**调用方**的活(通用面 #5:manager 不知道 lobby 行长什么样)。
 * 私密房不进列表 —— 只能靠码进(通用面 #7 双轨寻址)。
 * **排序**:没排序的话去重不可靠 —— 迭代顺序变化会被读成内容变化。
 */
export function buildLobbyList(manager: RoomManager): RoomSummary[] {
  return manager
    .allRooms()
    .filter((r) => !r.settings.isPrivate)
    .map((r) => r.toSummary())
    .sort((a, b) => (a.displayNumber ?? 0) - (b.displayNumber ?? 0));
}
