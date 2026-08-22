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

  /* — setup:录题(SPEC §6)。全部 oracle-only —— */
  SELECT_BANK_PUZZLE: 'c:select_bank_puzzle',
  SET_CUSTOM_PUZZLE: 'c:set_custom_puzzle',
  /** 换一题:清掉已录的题,回到选题界面。已用的仍算已用。 */
  CLEAR_PUZZLE: 'c:clear_puzzle',
  /** 开汤(海龟汤)/ 锁定后开局(20Q)→ playing。 */
  BEGIN_PLAYING: 'c:begin_playing',
  /** 20Q 的「随机建议」。**不是题库**,是 server 内一个词表。 */
  SUGGEST_ANSWER_WORD: 'c:suggest_answer_word',
} as const;

export const S2C = {
  HELLO_OK: 's:hello_ok',
  LOBBY_LIST: 's:lobby_list',
  ROOM_STATE: 's:room_state',
  ROOM_CLOSED: 's:room_closed',
  KICKED: 's:kicked',
  /** 建议词是点对点回给 oracle 的,不广播 —— 别人不该看见它。 */
  ANSWER_WORD_SUGGESTION: 's:answer_word_suggestion',
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
  /* — setup / 题库 — */
  'NOT_SETUP_PHASE',
  'PUZZLE_NOT_FOUND',
  /** 同房不重复:这题这一局已经用过了。 */
  'PUZZLE_ALREADY_USED',
  /** 题已录好,要换先 c:clear_puzzle —— 防止误覆盖。 */
  'PUZZLE_ALREADY_SET',
  'NO_PUZZLE_SET',
  'INVALID_PUZZLE',
  /** 这个 puzzle type 没有题库(config 表 hasBank=false)。 */
  'BANK_NOT_AVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** server 内部统一的返回形状。串行处理 + 显式拒绝,client 不做乐观更新。 */
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: ErrorCode };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (error: ErrorCode): Result<never> => ({ ok: false, error });
export const OK: Result<void> = { ok: true, value: undefined };
