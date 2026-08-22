/**
 * 房间状态 store。
 *
 * 一条纪律贯穿全文件:**client 不做乐观更新。**
 * 每个 action 只负责 emit,状态一律等 `s:room_state` 广播回来才变。
 * 座位申领尤其如此 —— 先到先得由 server 裁决,本地抢先画上去只会在被拒时闪一下。
 *
 * 错误也只存**语义 code**,中文在 strings.ts 里查(SPEC §8)。
 */

import { create } from 'zustand';
import { C2S, S2C, type ErrorCode } from '@shared/events';
import type { Answer } from '@shared/puzzleTypes';
import type { RoomSettings, RoomState, RoomSummary } from '@shared/types';
import { getSocket, onGateOverflow, onGateState, sendGated } from '@/lib/socket';
import { rememberNickname } from '@/lib/nickname';

export type Conn = 'connecting' | 'online' | 'offline';

interface RoomStore {
  conn: Conn;
  /**
   * **认领完成**才算可操作(不只是 socket 连上)。
   * 连上到收到 `s:hello_ok` 之间有一个短窗口 —— 那个窗口里点按钮会被 gate 排队,
   * UI 该显示成不可用而不是假装能用(NOTES 待决 #7)。
   */
  ready: boolean;
  room: RoomState | null;
  lobby: RoomSummary[];
  /** 最近一次被拒的语义码。展示完就该清掉。 */
  error: ErrorCode | null;
  /** 20Q 的随机建议词 —— 点对点回来的,不是房间状态。 */
  suggestion: string | null;
  /**
   * 最近一次判定更正。**独立于 room_state** —— 推理链被改写必须当场看得见,
   * 不能只靠 Q&A 流里那个小标记(SPEC §5)。
   */
  correction: { questionId: string; from: Answer | null; to: Answer | null } | null;

  clearError: () => void;
  clearSuggestion: () => void;
  clearCorrection: () => void;

  /* — actions:只 emit,不改本地状态 — */
  subscribeLobby: () => void;
  createRoom: (isPrivate: boolean) => void;
  joinRoom: (code: string) => void;
  leaveRoom: () => void;
  setReady: (ready: boolean) => void;
  setNickname: (nickname: string) => void;
  updateSettings: (patch: Partial<RoomSettings>) => void;
  kickPlayer: (playerId: string) => void;
  transferHost: (playerId: string) => void;
  claimOracle: () => void;
  releaseOracle: () => void;
  assignOracle: (playerId: string | null) => void;
  startGame: () => void;

  /* — setup — */
  selectBankPuzzle: (puzzleId: string) => void;
  setCustomPuzzle: (input: { surface?: string | null; truth: string; title?: string | null }) => void;
  clearPuzzle: () => void;
  beginPlaying: () => void;
  suggestAnswerWord: (exclude?: string) => void;

  /* — playing:判定循环 — */
  askQuestion: (text: string) => void;
  judge: (answer: Answer) => void;
  correctLast: (answer: Answer) => void;
  submitSolution: (text: string) => void;
  resolveSubmission: (submissionId: string, accept: boolean) => void;
  revealTruth: () => void;
  startNextRound: () => void;
  backToLobby: () => void;
}

/**
 * 业务事件的出口。**走 gate,不直接 socket.emit** ——
 * 直接 emit 会让断线期间的点击被 socket.io 缓冲,重连时抢在 `c:hello` 前面到达
 * server,被回一个没人看得见的 `INVALID_PAYLOAD`(NOTES 待决 #7)。
 */
const emit = (event: string, payload?: unknown) => sendGated(event, payload ?? {});

export const useRoomStore = create<RoomStore>((set) => ({
  conn: 'connecting',
  ready: false,
  room: null,
  lobby: [],
  error: null,
  suggestion: null,
  correction: null,

  clearError: () => set({ error: null }),
  clearSuggestion: () => set({ suggestion: null }),
  clearCorrection: () => set({ correction: null }),

  subscribeLobby: () => emit(C2S.LOBBY_SUBSCRIBE),
  createRoom: (isPrivate) => emit(C2S.CREATE_ROOM, { isPrivate }),
  joinRoom: (code) => emit(C2S.JOIN_ROOM, { code }),
  leaveRoom: () => {
    emit(C2S.LEAVE_ROOM);
    set({ room: null });
    emit(C2S.LOBBY_SUBSCRIBE);
  },
  setReady: (ready) => emit(C2S.SET_READY, { ready }),
  setNickname: (nickname) => emit(C2S.SET_NICKNAME, { nickname }),
  updateSettings: (patch) => emit(C2S.UPDATE_SETTINGS, patch),
  kickPlayer: (playerId) => emit(C2S.KICK_PLAYER, { playerId }),
  transferHost: (playerId) => emit(C2S.TRANSFER_HOST, { playerId }),
  claimOracle: () => emit(C2S.CLAIM_ORACLE),
  releaseOracle: () => emit(C2S.RELEASE_ORACLE),
  assignOracle: (playerId) => emit(C2S.ASSIGN_ORACLE, { playerId }),
  startGame: () => emit(C2S.START_GAME),

  selectBankPuzzle: (puzzleId) => emit(C2S.SELECT_BANK_PUZZLE, { puzzleId }),
  setCustomPuzzle: (input) => emit(C2S.SET_CUSTOM_PUZZLE, input),
  clearPuzzle: () => emit(C2S.CLEAR_PUZZLE),
  beginPlaying: () => emit(C2S.BEGIN_PLAYING),
  suggestAnswerWord: (exclude) => emit(C2S.SUGGEST_ANSWER_WORD, { exclude }),

  askQuestion: (text) => emit(C2S.ASK_QUESTION, { text }),
  judge: (answer) => emit(C2S.JUDGE, { answer }),
  correctLast: (answer) => emit(C2S.CORRECT_LAST, { answer }),
  submitSolution: (text) => emit(C2S.SUBMIT_SOLUTION, { text }),
  resolveSubmission: (submissionId, accept) =>
    emit(C2S.RESOLVE_SUBMISSION, { submissionId, accept }),
  revealTruth: () => emit(C2S.REVEAL_TRUTH),
  startNextRound: () => emit(C2S.START_NEXT_ROUND),
  backToLobby: () => emit(C2S.BACK_TO_LOBBY),
}));

/** 接线一次。App 挂载时调。 */
export function wireRoomSocket(): () => void {
  const s = getSocket();
  const set = useRoomStore.setState;

  const onConnect = () => set({ conn: 'online' });
  const onDisconnect = () => set({ conn: 'offline', ready: false });

  // gate 状态 → UI 可用状态。'ready' 之前按钮该是禁用的。
  const offState = onGateState((st) => set({ ready: st === 'ready' }));
  // 不静默丢:队列溢出要让用户看见。
  const offOverflow = onGateOverflow(() => set({ error: 'INTERNAL' }));

  const onRoomState = (state: RoomState) => {
    set({ room: state });
    // server 可能重摇过名字 —— 把结果写回本地,免得下次进房又用旧名。
    const me = state.players.find((p) => p.id === state.viewerId);
    if (me) rememberNickname(me.nickname);
  };

  const onLobbyList = (payload: { rooms: RoomSummary[] }) => set({ lobby: payload.rooms });
  const onError = (payload: { code: ErrorCode }) => set({ error: payload.code });
  const onClosed = () => set({ room: null });
  const onKicked = () => set({ room: null });
  const onSuggestion = (payload: { word: string }) => set({ suggestion: payload.word });
  const onCorrected = (payload: {
    questionId: string;
    from: Answer | null;
    to: Answer | null;
  }) => set({ correction: payload });

  s.on('connect', onConnect);
  s.on('disconnect', onDisconnect);
  s.on(S2C.ROOM_STATE, onRoomState);
  s.on(S2C.LOBBY_LIST, onLobbyList);
  s.on(S2C.ERROR, onError);
  s.on(S2C.ROOM_CLOSED, onClosed);
  s.on(S2C.KICKED, onKicked);
  s.on(S2C.ANSWER_WORD_SUGGESTION, onSuggestion);
  s.on(S2C.JUDGEMENT_CORRECTED, onCorrected);
  if (s.connected) set({ conn: 'online' });

  return () => {
    offState();
    offOverflow();
    s.off('connect', onConnect);
    s.off('disconnect', onDisconnect);
    s.off(S2C.ROOM_STATE, onRoomState);
    s.off(S2C.LOBBY_LIST, onLobbyList);
    s.off(S2C.ERROR, onError);
    s.off(S2C.ROOM_CLOSED, onClosed);
    s.off(S2C.KICKED, onKicked);
    s.off(S2C.ANSWER_WORD_SUGGESTION, onSuggestion);
    s.off(S2C.JUDGEMENT_CORRECTED, onCorrected);
  };
}

/* ───────────────── 便利选择器 ───────────────── */

export function useMe() {
  return useRoomStore((s) => s.room?.players.find((p) => p.id === s.room?.viewerId) ?? null);
}

export function useIsOracle(): boolean {
  return useRoomStore((s) => !!s.room && s.room.oracleId === s.room.viewerId);
}

export function useIsHost(): boolean {
  return useRoomStore((s) => !!s.room && s.room.hostId === s.room.viewerId);
}
