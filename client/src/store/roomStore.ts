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
import type { RoomSettings, RoomState, RoomSummary } from '@shared/types';
import { getSocket } from '@/lib/socket';
import { rememberNickname } from '@/lib/nickname';

export type Conn = 'connecting' | 'online' | 'offline';

interface RoomStore {
  conn: Conn;
  room: RoomState | null;
  lobby: RoomSummary[];
  /** 最近一次被拒的语义码。展示完就该清掉。 */
  error: ErrorCode | null;
  /** 20Q 的随机建议词 —— 点对点回来的,不是房间状态。 */
  suggestion: string | null;

  clearError: () => void;
  clearSuggestion: () => void;

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
}

const emit = (event: string, payload?: unknown) => getSocket().emit(event, payload ?? {});

export const useRoomStore = create<RoomStore>((set) => ({
  conn: 'connecting',
  room: null,
  lobby: [],
  error: null,
  suggestion: null,

  clearError: () => set({ error: null }),
  clearSuggestion: () => set({ suggestion: null }),

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
}));

/** 接线一次。App 挂载时调。 */
export function wireRoomSocket(): () => void {
  const s = getSocket();
  const set = useRoomStore.setState;

  const onConnect = () => set({ conn: 'online' });
  const onDisconnect = () => set({ conn: 'offline' });

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

  s.on('connect', onConnect);
  s.on('disconnect', onDisconnect);
  s.on(S2C.ROOM_STATE, onRoomState);
  s.on(S2C.LOBBY_LIST, onLobbyList);
  s.on(S2C.ERROR, onError);
  s.on(S2C.ROOM_CLOSED, onClosed);
  s.on(S2C.KICKED, onKicked);
  s.on(S2C.ANSWER_WORD_SUGGESTION, onSuggestion);
  if (s.connected) set({ conn: 'online' });

  return () => {
    s.off('connect', onConnect);
    s.off('disconnect', onDisconnect);
    s.off(S2C.ROOM_STATE, onRoomState);
    s.off(S2C.LOBBY_LIST, onLobbyList);
    s.off(S2C.ERROR, onError);
    s.off(S2C.ROOM_CLOSED, onClosed);
    s.off(S2C.KICKED, onKicked);
    s.off(S2C.ANSWER_WORD_SUGGESTION, onSuggestion);
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
