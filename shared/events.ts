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

  /* — playing:判定循环(SPEC §5)— */
  ASK_QUESTION: 'c:ask_question',
  /** 判队首。oracle-only。 */
  JUDGE: 'c:judge',
  /** 对**最近一条**已判问题重判一次。oracle-only。 */
  CORRECT_LAST: 'c:correct_last',
  /** 海龟汤:提交还原。独立通道,不占 pending cap。 */
  SUBMIT_SOLUTION: 'c:submit_solution',
  /** oracle 处理还原:accept → 命中收束 / reject → 无消耗。 */
  RESOLVE_SUBMISSION: 'c:resolve_submission',
  /** reveal:改「下一局出题人」。host-only,reveal-only(不是中段接管)。 */
  SET_NEXT_ORACLE: 'c:set_next_oracle',
  /** oracle「公开汤底 · 结束本局」。client 端必须先弹确认框(SPEC §5 防误触)。 */
  REVEAL_TRUTH: 'c:reveal_truth',

  /* — reveal 出口:两条边都会归位,第二局不带脏状态 — */
  START_NEXT_ROUND: 'c:start_next_round',
  BACK_TO_LOBBY: 'c:back_to_lobby',
} as const;

export const S2C = {
  HELLO_OK: 's:hello_ok',
  LOBBY_LIST: 's:lobby_list',
  ROOM_STATE: 's:room_state',
  ROOM_CLOSED: 's:room_closed',
  KICKED: 's:kicked',
  /** 建议词是点对点回给 oracle 的,不广播 —— 别人不该看见它。 */
  ANSWER_WORD_SUGGESTION: 's:answer_word_suggestion',
  /**
   * 判定被更正。**独立事件**,不只是靠 room_state 里那个 corrected 标记 ——
   * client 要能就地提示「刚才那条改判了」,否则推理链会被悄悄改写。
   * payload 只带语义:{ questionId, from, to }。
   */
  JUDGEMENT_CORRECTED: 's:judgement_corrected',
  /**
   * 出题人被转移(SPEC §7 中段接管)。**独立事件** —— 局中换判定的人是件大事,
   * 光靠 room_state 里 oracleId 变了,桌上的人不一定会注意到。
   * payload 只带语义:{ from, to }(playerId,不带昵称)。
   */
  ORACLE_TRANSFERRED: 's:oracle_transferred',
  /**
   * 房主换人了。**独立事件** —— 显式转让、host 离开、宽限到期被扫走,三条路都发。
   * 桌上的人需要知道现在谁能开下一局。payload 只带语义:{ from, to }。
   */
  HOST_TRANSFERRED: 's:host_transferred',
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
  /* — playing / 判定循环 — */
  'NOT_PLAYING_PHASE',
  'QUEUE_EMPTY',
  /** 额度是入队许可证 —— 归零后不能再入队(已在队的照判)。 */
  'NO_BUDGET_LEFT',
  /** 自己有未判问题,先等判完。与额度是两套账。 */
  'PENDING_CAP_REACHED',
  /** oracle 不提问、不交还原 —— ta 手上有答案。 */
  'ORACLE_CANNOT_ASK',
  /** 这个判定值不在 config 表的 answers 里。 */
  'ANSWER_NOT_ALLOWED',
  'NOTHING_TO_CORRECT',
  /** 一条只能重判一次,防翻旧账。 */
  'ALREADY_CORRECTED',
  /** 这个 puzzle type 没有还原通道(guessMode !== 'submission')。 */
  'SUBMISSION_NOT_AVAILABLE',
  /** 自己已有一条未决还原。 */
  'SUBMISSION_PENDING',
  'SUBMISSION_NOT_FOUND',
  'NOT_REVEAL_PHASE',
  /** 中段转移出题人:人不够(2 人房换完就没有干净的猜题人了)。 */
  'TOO_FEW_FOR_TRANSFER',
  /**
   * 事件太密,这一条被丢掉了。**不断连接** —— 手抖点快了不该把人踢下线。
   * 定位是「随机扫描器保险」,不是抗定向攻击。
   */
  'RATE_LIMITED',
  /**
   * client 侧专用:认领成功,但它记着的房间已经不在了(server 重启)。
   * **server 从不发这个** —— 它是 client 对完账之后自己用来查文案的 key。
   */
  'ROOM_GONE',
  /** client 侧:房间被闲置扫描关掉了。和 ROOM_GONE 同一个形状 —— 房没了要有句人话。 */
  'ROOM_CLOSED_IDLE',
  /** client 侧:人走光了,房间自然关闭。 */
  'ROOM_CLOSED_EMPTY',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** server 内部统一的返回形状。串行处理 + 显式拒绝,client 不做乐观更新。 */
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: ErrorCode };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (error: ErrorCode): Result<never> => ({ ok: false, error });
export const OK: Result<void> = { ok: true, value: undefined };
