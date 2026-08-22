/**
 * 展示字符串字典 —— **所有中文/英文的唯一住处**(SPEC §8)。
 *
 * 纪律:
 *  · **server 只发语义 enum / key,永不发展示字符串。** 判定、phase、错误码、
 *    系统事件全部走 enum,到这里才变成人话。
 *  · 用户产出内容(题目、提问、还原文本)**原样透传**,不进字典。
 *  · **不引 i18n 框架。** 双列字典 + `t(key)` 就够了。
 *  · 默认 zh,**zh 是被测路径**;en 顺手填,不单独测。
 *
 * 类型上钉死:`Record<ErrorCode, string>` 之类的写法保证漏一个 key 是编译错误,
 * 不是运行时才发现的空白。
 */

import type { ErrorCode } from '@shared/events';
import type { Answer } from '@shared/puzzleTypes';
import type { PuzzleTypeId } from '@shared/puzzleTypes';
import type { Phase } from '@shared/types';

export type Lang = 'zh' | 'en';

/**
 * 图标双编码(SPEC §9 修正 3):判定**永远**是颜色 + 图标两条编码,
 * 不许只靠颜色承载语义。图标不随语言变,所以不进双列字典。
 */
export const ANSWER_ICON: Record<Answer, string> = {
  YES: '✓',
  NO: '✗',
  IRRELEVANT: '—',
  BOTH: '◐',
  UNCLEAR: '?',
  CORRECT: '★',
};

/** Tailwind token 名,与 tailwind.config.js 的 `judge.*` 一一对应。 */
export const ANSWER_TOKEN: Record<Answer, string> = {
  YES: 'judge-yes',
  NO: 'judge-no',
  IRRELEVANT: 'judge-irrelevant',
  BOTH: 'judge-both',
  UNCLEAR: 'judge-unclear',
  CORRECT: 'judge-correct',
};

interface Dict {
  answer: Record<Answer, string>;
  phase: Record<Phase, string>;
  puzzleType: Record<PuzzleTypeId, string>;
  error: Record<ErrorCode, string>;
  ui: Record<string, string>;
}

const zh: Dict = {
  answer: {
    YES: '是',
    NO: '不是',
    IRRELEVANT: '无关',
    BOTH: '是也不是',
    UNCLEAR: '不确定',
    CORRECT: '就是它!',
  },
  phase: {
    lobby: '等待中',
    setup: '录题中',
    playing: '推理中',
    reveal: '揭晓',
  },
  puzzleType: {
    twenty_questions: '二十个问题',
    situation: '海龟汤',
  },
  error: {
    ROOM_NOT_FOUND: '找不到这个房间',
    ROOM_FULL: '房间满了',
    ROOM_LIMIT_REACHED: '房间数已达上限,稍后再试',
    NOT_IN_ROOM: '你不在房间里',
    NOT_HOST: '只有房主能做这件事',
    NOT_LOBBY_PHASE: '开局之后不能改',
    PLAYER_NOT_FOUND: '找不到这个玩家',
    CANNOT_TARGET_SELF: '不能对自己做这件事',
    SEAT_TAKEN: '座位已被占',
    NOT_ORACLE: '只有出题人能做这件事',
    NO_ORACLE_SEATED: '还没有人坐上出题人',
    NOT_ALL_READY: '还有人没准备好',
    NOT_ENOUGH_PLAYERS: '至少需要 2 人(1 出题人 + 1 猜题人)',
    INVALID_SETTINGS: '设置不合法',
    INVALID_PAYLOAD: '请求不合法',
    INTERNAL: '出了点问题,再试一次',
  },
  ui: {
    'app.title': '海龟汤 · 暗房',
    'lobby.create': '点亮一盏灯 · 建房',
    'lobby.join': '循码入局',
    'lobby.or': '或',
    'seat.oracle': '出题人',
    'seat.claim': '我来出题',
    'seat.release': '让出座位',
    'seat.empty': '虚位以待',
    'player.reroll': '换个名字',
    'game.start': '开始',
    'conn.connecting': '连接中…',
    'conn.online': '已连接',
    'conn.offline': '已断开',
  },
};

const en: Dict = {
  answer: {
    YES: 'Yes',
    NO: 'No',
    IRRELEVANT: 'Irrelevant',
    BOTH: 'Both',
    UNCLEAR: 'Unclear',
    CORRECT: "That's it!",
  },
  phase: {
    lobby: 'Waiting',
    setup: 'Setting up',
    playing: 'In play',
    reveal: 'Reveal',
  },
  puzzleType: {
    twenty_questions: 'Twenty Questions',
    situation: 'Lateral Thinking',
  },
  error: {
    ROOM_NOT_FOUND: 'Room not found',
    ROOM_FULL: 'Room is full',
    ROOM_LIMIT_REACHED: 'Too many rooms right now, try again later',
    NOT_IN_ROOM: 'You are not in a room',
    NOT_HOST: 'Only the host can do that',
    NOT_LOBBY_PHASE: 'Cannot change this after the round starts',
    PLAYER_NOT_FOUND: 'Player not found',
    CANNOT_TARGET_SELF: 'You cannot do that to yourself',
    SEAT_TAKEN: 'Seat already taken',
    NOT_ORACLE: 'Only the oracle can do that',
    NO_ORACLE_SEATED: 'Nobody is in the oracle seat yet',
    NOT_ALL_READY: 'Not everyone is ready',
    NOT_ENOUGH_PLAYERS: 'Needs at least 2 (1 oracle + 1 guesser)',
    INVALID_SETTINGS: 'Invalid settings',
    INVALID_PAYLOAD: 'Invalid request',
    INTERNAL: 'Something went wrong, try again',
  },
  ui: {
    'app.title': 'The Dark Room',
    'lobby.create': 'Light a lamp · New room',
    'lobby.join': 'Join by code',
    'lobby.or': 'or',
    'seat.oracle': 'Oracle',
    'seat.claim': 'I will host the puzzle',
    'seat.release': 'Leave the seat',
    'seat.empty': 'Seat open',
    'player.reroll': 'New name',
    'game.start': 'Start',
    'conn.connecting': 'Connecting…',
    'conn.online': 'Connected',
    'conn.offline': 'Disconnected',
  },
};

const DICTS: Record<Lang, Dict> = { zh, en };

/**
 * `t('ui', 'lobby.create')` / `t('error', code)` / `t('answer', 'YES')`。
 * 分组取值,所以漏 key 在类型层就被抓住。
 */
export function translate<K extends keyof Dict>(
  lang: Lang,
  group: K,
  key: keyof Dict[K],
): string {
  const dict = DICTS[lang][group] as Record<string, string>;
  const fallback = DICTS.zh[group] as Record<string, string>;
  return dict[key as string] ?? fallback[key as string] ?? String(key);
}
