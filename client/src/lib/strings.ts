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

/**
 * 判定**图标**的 class(DECISIONS #6 + session 5 修正 2)。
 *
 * ⚠️ **颜色只给图标,文字一律中性墨色。**
 * session 5 的 smoke 反馈:整条 chip 连文字一起上色,四五条并排时太闹,
 * 而判定本来就是图标 + 文字**双编码** —— 颜色的活由图标一个人干就够了。
 *
 * 「是也不是」没有单一颜色可用,给的是 `.judge-both-mark`(index.css,绿→红柔和过渡)。
 * 判定按钮组直接吃这张表,不需要判 puzzle type。
 */
export const ANSWER_ICON_CLASS: Record<Answer, string> = {
  YES: 'text-judge-yes',
  NO: 'text-judge-no',
  IRRELEVANT: 'text-judge-irrelevant',
  UNCLEAR: 'text-judge-unclear',
  /** 左半绿、右半红:一半是、一半不是。琥珀已退出普通判定色。 */
  BOTH: 'judge-both-mark',
  /** ★ 命中态 —— 三焦点之一,琥珀名正言顺。 */
  CORRECT: 'text-judge-correct',
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
    NOT_SETUP_PHASE: '现在不是录题阶段',
    PUZZLE_NOT_FOUND: '找不到这道题',
    PUZZLE_ALREADY_USED: '这题今晚已经用过了',
    PUZZLE_ALREADY_SET: '已经选好题了,要换请点「换一题」',
    NO_PUZZLE_SET: '还没选题',
    INVALID_PUZZLE: '题目内容不合法',
    BANK_NOT_AVAILABLE: '这个玩法没有题库',
    NOT_PLAYING_PHASE: '这一局已经结束了',
    QUEUE_EMPTY: '没有待判的问题',
    NO_BUDGET_LEFT: '额度用完了',
    PENDING_CAP_REACHED: '先等你上一个问题被判定',
    ORACLE_CANNOT_ASK: '出题人不能提问',
    ANSWER_NOT_ALLOWED: '这个判定在本玩法里不存在',
    NOTHING_TO_CORRECT: '还没有可以改的判定',
    ALREADY_CORRECTED: '这条已经改过一次了',
    SUBMISSION_NOT_AVAILABLE: '这个玩法没有还原通道',
    SUBMISSION_PENDING: '你已经有一条还原在等回复',
    SUBMISSION_NOT_FOUND: '找不到这条还原',
    NOT_REVEAL_PHASE: '现在不是揭晓阶段',
    TOO_FEW_FOR_TRANSFER: '人太少,现在不能转移出题人',
    RATE_LIMITED: '慢一点 —— 刚才那下没算数',
    ROOM_GONE: '房间已不存在 —— 服务器重启过,这一局没有保存',
    ROOM_CLOSED_IDLE: '房间已因闲置关闭',
    ROOM_CLOSED_EMPTY: '房间已关闭 —— 人都走光了',
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
    'seat.youAreOracle': '你是出题人',
    'player.reroll': '换个名字',
    'game.start': '开始',
    'conn.connecting': '连接中…',
    'conn.online': '已连接',
    'conn.offline': '已断开',
    'conn.identifying': '正在认领身份…',

    'landing.tagline': '夜深了,谜题已备好。',
    'landing.kicker': '海龟汤 · 暗房',
    'landing.codePlaceholder': '四位房间码',
    'lobby.roomCode': '密室',
    'lobby.shareHint': '把这个码报给朋友',
    'lobby.copy': '复制邀请',
    'lobby.copied': '已复制',
    'lobby.players': '在座玩家',
    'lobby.ready': '准备好了',
    'lobby.unready': '还没好',
    'lobby.settings': '本局设置',
    'lobby.puzzleType': '玩法',
    'lobby.budget': '提问额度',
    'lobby.pendingCap': '每人未判上限',
    'lobby.maxPlayers': '房间容量',
    'lobby.private': '私密房(不进大厅列表)',
    'lobby.leave': '离开房间',
    'lobby.kick': '请离',
    'lobby.makeHost': '转让房主',
    'lobby.you': '你',
    'lobby.host': '房主',
    'lobby.list': '正在进行的房间',
    'lobby.listEmpty': '现在没有公开的房间。开一间?',
    'lobby.joinRow': '加入',

    'setup.oracleTitle': '录一道题',
    'setup.guesserTitle': '出题人正在准备',
    'setup.guesserWait': '稍等片刻 —— 汤面上来之前先喝口水。',
    'setup.bank': '题库',
    'setup.bankEmpty': '今晚的题库用完了,自己写一道吧。',
    'setup.own': '自己写',
    'setup.surface': '汤面(全房可见)',
    'setup.truth': '汤底(只有你看得见)',
    'setup.title': '题名(可留空)',
    'setup.answerWord': '答案词(只有你看得见)',
    'setup.suggest': '随机建议',
    'setup.confirm': '就这道',
    'setup.another': '换一题',
    'setup.openSoup': '开汤',
    'setup.lockWord': '锁定,开始',
    'setup.surfacePublic': '汤面已公开,大家正在读',
    'setup.truthHeld': '汤底在你手上',
    'setup.wordHeld': '答案词已锁定,只有你看得见',
    'setup.difficulty': '难度',
    'setup.chooseFromBank': '从题库选',
    'setup.writeOwn': '自己写一道',

    'play.askPlaceholder': '问一个是非问题…',
    'play.ask': '提问',
    'play.queue': '待判定',
    'play.stream': '问答流',
    'play.streamEmpty': '还没有人提问。第一个问题往往最贵。',
    'play.budget': '剩余额度',
    'play.budgetOut': '额度已用完',
    'play.waitingJudge': '等出题人判定',
    'play.yourTurn': '轮到你判了',
    'play.judgeHead': '判队首',
    'play.noPending': '队列空着',
    'play.correctLast': '改判上一条',
    'play.correctedFrom': '原判',
    'play.corrected': '已更正',
    'play.pendingBlocked': '你有一个问题还没被判定',
    'play.submit': '提交还原',
    'play.submitPlaceholder': '把你想到的完整故事写下来…',
    'play.submissions': '还原提交',
    'play.accept': '就是这样',
    'play.reject': '不是',
    'play.accepted': '已采纳',
    'play.rejected': '未采纳',
    'play.revealTruth': '公开汤底 · 结束本局',
    'play.revealConfirm': '确定要公开汤底吗?这一局会立刻结束,记为未猜中。',
    'play.confirm': '确定',
    'play.cancel': '再想想',
    'play.by': '来自',

    'reveal.hit': '猜中了',
    'reveal.exhausted': '额度用尽,没能猜中',
    'reveal.revealed': '出题人公开了汤底',
    'reveal.truth': '真相',
    'reveal.winner': '命中者',
    'reveal.questionsUsed': '共用问题',
    'reveal.duration': '用时',
    'reveal.nextRound': '再来一局',
    'reveal.backToLobby': '回大厅改设置',
    'reveal.nextOracle': '下一局出题人',
    'reveal.hitQuestion': '命中的那一问',
    'reveal.hitSubmission': '命中的还原',
    'reveal.change': '改派',
    'reveal.noOracle': '暂不指定',
    'oracle.transferred': '出题人已转移',
    'oracle.transferTo': '转移出题人',
    'oracle.transferConfirm': '转移后 {name} 将立即看到汤底并接手判定;你将变为猜题者,且你已知道答案。',
    'oracle.transferConfirmYes': '确认转移',
    'oracle.transferTooFew': '人太少,转移之后就没有还没看过汤底的猜题人了',

    'room.leave': '离开房间',
    'room.leaveConfirm': '确定要离开这个房间吗?',
    'room.leaveConfirmOracle': '你是出题人。离开之后座位会空出来,由房主指派新的出题人接手 —— 题目不会丢。',
    'room.leaveConfirmPlaying': '这一局还在进行中。离开之后你就不在这一局里了。',
    'room.leaveYes': '离开',

    'host.offline': '房主已离线,若未归将自动移交',
    'host.transferred': '房主已移交给 {name}',
    'player.offline': '离线',
    'lang.toZh': '中文',
    'lang.toEn': 'EN',

    'reveal.waitingHost': '等房主开始下一局',
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
    NOT_SETUP_PHASE: 'Not in the setup phase',
    PUZZLE_NOT_FOUND: 'Puzzle not found',
    PUZZLE_ALREADY_USED: 'This one has been used tonight',
    PUZZLE_ALREADY_SET: 'A puzzle is already chosen — use "another one" to swap',
    NO_PUZZLE_SET: 'No puzzle chosen yet',
    INVALID_PUZZLE: 'Invalid puzzle content',
    BANK_NOT_AVAILABLE: 'This mode has no puzzle bank',
    NOT_PLAYING_PHASE: 'This round is over',
    QUEUE_EMPTY: 'Nothing waiting to be judged',
    NO_BUDGET_LEFT: 'Out of questions',
    PENDING_CAP_REACHED: 'Wait for your last question to be judged',
    ORACLE_CANNOT_ASK: 'The oracle does not ask',
    ANSWER_NOT_ALLOWED: 'That judgement does not exist in this mode',
    NOTHING_TO_CORRECT: 'Nothing to correct yet',
    ALREADY_CORRECTED: 'That one has already been corrected once',
    SUBMISSION_NOT_AVAILABLE: 'This mode has no solution channel',
    SUBMISSION_PENDING: 'You already have a solution awaiting a reply',
    SUBMISSION_NOT_FOUND: 'Solution not found',
    NOT_REVEAL_PHASE: 'Not in the reveal phase',
    TOO_FEW_FOR_TRANSFER: 'Too few players to hand over the oracle seat right now',
    RATE_LIMITED: 'Slow down — that one did not go through',
    ROOM_GONE: 'That room is gone — the server restarted and rounds are not saved',
    ROOM_CLOSED_IDLE: 'The room was closed after sitting idle',
    ROOM_CLOSED_EMPTY: 'The room closed — everyone left',
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
    'seat.youAreOracle': 'You are the oracle',
    'player.reroll': 'New name',
    'game.start': 'Start',
    'conn.connecting': 'Connecting…',
    'conn.online': 'Connected',
    'conn.offline': 'Disconnected',
    'conn.identifying': 'Claiming your seat…',

    'landing.tagline': 'It is late. The puzzle is ready.',
    'landing.kicker': 'The Dark Room',
    'landing.codePlaceholder': 'Four-digit code',
    'lobby.roomCode': 'Room',
    'lobby.shareHint': 'Read this code out to your friends',
    'lobby.copy': 'Copy invite',
    'lobby.copied': 'Copied',
    'lobby.players': 'At the table',
    'lobby.ready': 'Ready',
    'lobby.unready': 'Not ready',
    'lobby.settings': 'Round settings',
    'lobby.puzzleType': 'Mode',
    'lobby.budget': 'Question budget',
    'lobby.pendingCap': 'Pending per player',
    'lobby.maxPlayers': 'Room size',
    'lobby.private': 'Private (unlisted)',
    'lobby.leave': 'Leave room',
    'lobby.kick': 'Remove',
    'lobby.makeHost': 'Make host',
    'lobby.you': 'you',
    'lobby.host': 'host',
    'lobby.list': 'Open rooms',
    'lobby.listEmpty': 'No open rooms right now. Start one?',
    'lobby.joinRow': 'Join',

    'setup.oracleTitle': 'Set a puzzle',
    'setup.guesserTitle': 'The oracle is preparing',
    'setup.guesserWait': 'Hold on — get a drink before the surface arrives.',
    'setup.bank': 'Puzzle bank',
    'setup.bankEmpty': 'The bank is used up tonight. Write your own.',
    'setup.own': 'Write your own',
    'setup.surface': 'Surface (everyone sees this)',
    'setup.truth': 'Truth (only you see this)',
    'setup.title': 'Title (optional)',
    'setup.answerWord': 'Answer (only you see this)',
    'setup.suggest': 'Suggest one',
    'setup.confirm': 'This one',
    'setup.another': 'Another one',
    'setup.openSoup': 'Serve it',
    'setup.lockWord': 'Lock it in',
    'setup.surfacePublic': 'The surface is public — everyone is reading',
    'setup.truthHeld': 'You hold the truth',
    'setup.wordHeld': 'Answer locked. Only you can see it.',
    'setup.difficulty': 'Difficulty',
    'setup.chooseFromBank': 'From the bank',
    'setup.writeOwn': 'Write your own',

    'play.askPlaceholder': 'Ask a yes/no question…',
    'play.ask': 'Ask',
    'play.queue': 'Waiting',
    'play.stream': 'Q&A',
    'play.streamEmpty': 'No questions yet. The first one is always the most expensive.',
    'play.budget': 'Questions left',
    'play.budgetOut': 'Out of questions',
    'play.waitingJudge': 'Waiting for the oracle',
    'play.yourTurn': 'Your call',
    'play.judgeHead': 'Judge the head',
    'play.noPending': 'Queue is empty',
    'play.correctLast': 'Correct the last one',
    'play.correctedFrom': 'was',
    'play.corrected': 'corrected',
    'play.pendingBlocked': 'You have a question still waiting',
    'play.submit': 'Submit a solution',
    'play.submitPlaceholder': 'Write out the whole story as you see it…',
    'play.submissions': 'Solutions',
    'play.accept': "That's it",
    'play.reject': 'Not it',
    'play.accepted': 'accepted',
    'play.rejected': 'not it',
    'play.revealTruth': 'Reveal the truth · end the round',
    'play.revealConfirm': 'Reveal the truth? The round ends now and counts as unsolved.',
    'play.confirm': 'Reveal',
    'play.cancel': 'Never mind',
    'play.by': 'from',

    'reveal.hit': 'Solved',
    'reveal.exhausted': 'Out of questions, unsolved',
    'reveal.revealed': 'The oracle revealed it',
    'reveal.truth': 'The truth',
    'reveal.winner': 'Got it',
    'reveal.questionsUsed': 'Questions used',
    'reveal.duration': 'Time',
    'reveal.nextRound': 'Another round',
    'reveal.backToLobby': 'Back to the lobby',
    'reveal.nextOracle': 'Next oracle',
    'reveal.hitQuestion': 'The question that got it',
    'reveal.hitSubmission': 'The solution that got it',
    'reveal.change': 'Change',
    'reveal.noOracle': 'Leave it open',
    'oracle.transferred': 'The oracle seat changed hands',
    'oracle.transferTo': 'Hand the seat to',
    'oracle.transferConfirm': 'After this, {name} sees the truth immediately and takes over judging. You become a guesser — one who already knows the answer.',
    'oracle.transferConfirmYes': 'Hand it over',
    'oracle.transferTooFew': 'Too few players — nobody would be left who has not seen the truth',

    'room.leave': 'Leave room',
    'room.leaveConfirm': 'Leave this room?',
    'room.leaveConfirmOracle': 'You are the oracle. The seat opens up and the host picks someone to take over — the puzzle is not lost.',
    'room.leaveConfirmPlaying': 'This round is still running. You will not be in it any more.',
    'room.leaveYes': 'Leave',

    'host.offline': 'The host is offline — the room will hand over if they do not return',
    'host.transferred': 'Host handed over to {name}',
    'player.offline': 'offline',
    'lang.toZh': '中文',
    'lang.toEn': 'EN',

    'reveal.waitingHost': 'Waiting for the host to start the next round',
  },
};

const DICTS: Record<Lang, Dict> = { zh, en };

/**
 * `t('ui', 'lobby.create')` / `t('error', code)` / `t('answer', 'YES')`。
 * 分组取值,所以漏 key 在类型层就被抓住。
 */
/** 把 `{name}` 之类的占位换掉。字典里只留模板,拼装在调用点。 */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

export function translate<K extends keyof Dict>(
  lang: Lang,
  group: K,
  key: keyof Dict[K],
): string {
  const dict = DICTS[lang][group] as Record<string, string>;
  const fallback = DICTS.zh[group] as Record<string, string>;
  return dict[key as string] ?? fallback[key as string] ?? String(key);
}
