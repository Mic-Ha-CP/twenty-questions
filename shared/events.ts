/**
 * Socket 事件名 + 错误码。
 *
 * CONVENTIONS.md:方向前缀 `c:*` = client→server,`s:*` = server→client。
 * SPEC §8:**server 只发语义 enum / key,永不发展示字符串。**
 * 错误码也是 key —— client 拿 `ErrorCode` 去 strings.ts 查中文,server 不发中文。
 */

export const C2S = {
  /* — 身份 / lobby 频道 — */
  HELLO: 'c:hello',
  LOBBY_SUBSCRIBE: 'c:lobby_subscribe',
  LOBBY_UNSUBSCRIBE: 'c:lobby_unsubscribe',

  /* — 房间层 — */
  CREATE_ROOM: 'c:create_room',
  JOIN_ROOM: 'c:join_room',
  LEAVE_ROOM: 'c:leave_room',
  SET_READY: 'c:set_ready',
  UPDATE_SETTINGS: 'c:update_settings',
  KICK_PLAYER: 'c:kick_player',
  TRANSFER_HOST: 'c:transfer_host',
  SET_NICKNAME: 'c:set_nickname',

  /* — oracle 座位(游戏层,SPEC §2)— */
  CLAIM_ORACLE: 'c:claim_oracle',
  RELEASE_ORACLE: 'c:release_oracle',
  ASSIGN_ORACLE: 'c:assign_oracle',

  /* — phase — */
  START_GAME: 'c:start_game',
} as const;

export const S2C = {
  HELLO_OK: 's:hello_ok',
  LOBBY_LIST: 's:lobby_list',
  ROOM_STATE: 's:room_state',
  ROOM_CLOSED: 's:room_closed',
  KICKED: 's:kicked',
  /** 所有拒绝走这一条。payload = { code: ErrorCode }。**不带中文。** */
  ERROR: 's:error',
} as const;

export type C2SEvent = (typeof C2S)[keyof typeof C2S];
export type S2CEvent = (typeof S2C)[keyof typeof S2C];

/**
 * 语义错误码。client 用它查 strings.ts。
 * 加错误码时**只加 enum**,中文加在 client 的字典里。
 */
export const ERROR_CODES = [
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_LIMIT_REACHED',
  'NOT_IN_ROOM',
  'NOT_HOST',
  'NOT_LOBBY_PHASE',
  'PLAYER_NOT_FOUND',
  'CANNOT_TARGET_SELF',
  /** oracle 座位申领竞争落败 —— 先到先得(SPEC §2)。 */
  'SEAT_TAKEN',
  'NOT_ORACLE',
  /** start gate 未满足(SPEC §3)。 */
  'NO_ORACLE_SEATED',
  'NOT_ALL_READY',
  'NOT_ENOUGH_PLAYERS',
  'INVALID_SETTINGS',
  'INVALID_PAYLOAD',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** server 内部统一的返回形状。串行处理 + 显式拒绝,client 不做乐观更新。 */
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: ErrorCode };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (error: ErrorCode): Result<never> => ({ ok: false, error });
export const OK: Result<void> = { ok: true, value: undefined };
