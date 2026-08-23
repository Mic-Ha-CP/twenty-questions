/**
 * Playing —— 判定循环屏(SPEC §5)。双视角。照稿 #2a 的 4a–4d 细调。
 *
 * SPEC §4 允许 client 分支渲染的**三处之二**在这一屏:
 *   · 判定按钮组 —— 照 config 表的 `answers` 渲染,不判类型;
 *   · guess 入口 —— 20Q 无摊牌按钮(猜测即提问);海龟汤有「提交还原」。
 *
 * 琥珀纪律(SPEC §9 / DECISIONS #6),这一屏只有三处:
 *   **汤面区**、**额度计数**(顶条的 BudgetPill)、**★ 命中**(判定组的 CORRECT
 *   与海龟汤 accept)。别的一律中性。
 *
 * 判定 chip 的着色(session 5 修正 2):**颜色只给图标,文字用中性墨色。**
 * 判定本来就是图标 + 文字双编码,颜色的活由图标一个人干就够了。
 */

import { useEffect, useState } from 'react';
import type { Question } from '@shared/judging';
import { JUDGING_LIMITS } from '@shared/judging';
import { puzzleConfig, type Answer } from '@shared/puzzleTypes';
import { PlayerTag, PlayerTagById, SeatDot } from '@/components/player';
import { RoomHeader, ScreenShell } from '@/components/RoomHeader';
import { Button, Kicker, Narrative, Panel, TextArea, TextInput } from '@/components/ui';
import { shouldShowTruthPanel } from '@/lib/seats';
import { ANSWER_ICON, ANSWER_ICON_CLASS } from '@/lib/strings';
import { useIsHost, useIsOracle, useRoomStore } from '@/store/roomStore';
import { useT } from '@/store/langStore';

export default function Playing() {
  const isOracle = useIsOracle();

  return (
    <ScreenShell wide>
      <RoomHeader />
      <SurfacePanel />
      <TruthPanel />
      <CorrectionNotice />
      <OracleTransferNotice />
      {isOracle ? <OracleControls /> : <GuesserControls />}
      <Stream />
      <Submissions />
      <FooterControls />
    </ScreenShell>
  );
}

/* ══════════════════ 汤面区 —— 三焦点之一,可以用琥珀 ══════════════════ */

function SurfacePanel() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const [open, setOpen] = useState(true);
  if (!room.puzzle?.surface) return null;

  return (
    <Panel className="border-accent/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-5 pt-4 text-left"
      >
        <Kicker>{t('ui', 'setup.surface')}</Kicker>
        {/* 窄屏优先可折叠:汤面很长时,先把提问框露出来 */}
        <span className="ml-auto text-xs text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          {/* 题名与 Setup / Reveal 同一写法:汤面区是三焦点之一,标题可用琥珀 */}
          {room.puzzle.title && (
            <div className="px-5 pt-2 text-sm text-accent">{room.puzzle.title}</div>
          )}
          <Narrative className="px-5 pb-5 pt-2">{room.puzzle.surface}</Narrative>
        </>
      )}
    </Panel>
  );
}

/**
 * ★ session 5 修正 1:oracle 的**常驻真相面板**。
 *
 * 两个理由,都是 smoke 实测出来的:
 *   · **中途接管者靠它接得住** —— SPEC §7 说「真相在系统里,游戏不死」,
 *     但真相得有个看得见的地方,否则接管者只能干瞪眼;
 *   · 原 oracle 判到后段也会忘,海龟汤的汤底尤其长。
 *
 * 结构性缺席纪律不变:`oracleTruth` 本来就只在 oracle 那一份 RoomState 里非 null,
 * guesser 连渲染的机会都没有(`shouldShowTruthPanel`,有单测)。
 * 默认折叠 —— 出题人不必一直盯着它,而且旁边可能有人在看屏幕。
 */
function TruthPanel() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const [open, setOpen] = useState(false);
  if (!shouldShowTruthPanel(room)) return null;

  const isWord = !room.puzzle?.surface; // 20Q 的答案词是单行

  return (
    <Panel>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-5 py-3 text-left"
      >
        <span aria-hidden className="text-xs text-muted">
          🔒
        </span>
        <Kicker>{isWord ? t('ui', 'setup.answerWord') : t('ui', 'setup.truth')}</Kicker>
        <span className="ml-auto text-xs text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        // serif 只给叙事文本 —— 汤底是叙事文本
        <Narrative className="whitespace-pre-wrap px-5 pb-5 text-[15px]">
          {room.oracleTruth}
        </Narrative>
      )}
    </Panel>
  );
}

/* ══════════════════════════ 通知条 ══════════════════════════ */

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-judge-unclear/45 bg-panel px-4 py-2 text-sm text-ink">
      {children}
    </div>
  );
}

/** 判定被更正 —— 推理链被改写必须当场看得见(SPEC §5)。 */
function CorrectionNotice() {
  const t = useT();
  const correction = useRoomStore((s) => s.correction);
  const clear = useRoomStore((s) => s.clearCorrection);

  useEffect(() => {
    if (!correction) return;
    const id = setTimeout(clear, 6000);
    return () => clearTimeout(id);
  }, [correction, clear]);

  if (!correction) return null;
  return (
    <Notice>
      {t('ui', 'play.corrected')}:{' '}
      {correction.from && <span className="text-muted">{t('answer', correction.from)}</span>}
      {' → '}
      {correction.to && <b>{t('answer', correction.to)}</b>}
    </Notice>
  );
}

/** 出题人被转移(SPEC §7)—— 谁在判直接决定这条推理链还算不算数。 */
function OracleTransferNotice() {
  const t = useT();
  const transfer = useRoomStore((s) => s.oracleTransfer);
  const clear = useRoomStore((s) => s.clearOracleTransfer);

  useEffect(() => {
    if (!transfer) return;
    const id = setTimeout(clear, 6000);
    return () => clearTimeout(id);
  }, [transfer, clear]);

  if (!transfer) return null;
  return (
    <Notice>
      {t('ui', 'oracle.transferred')} → <PlayerTagById id={transfer.to} />
    </Notice>
  );
}

/* ══════════════════════════ 判定记号 ══════════════════════════ */

/** 图标 + 文字双编码。**颜色只在图标上**,文字中性(session 5 修正 2)。 */
function AnswerMark({ answer }: { answer: Answer }) {
  const t = useT();
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1 text-xs">
      <b className={ANSWER_ICON_CLASS[answer]}>{ANSWER_ICON[answer]}</b>
      <span className={answer === 'IRRELEVANT' ? 'text-muted' : 'text-ink'}>
        {t('answer', answer)}
      </span>
    </span>
  );
}

/* ══════════════════════════ 共享问答流 ══════════════════════════ */

function QuestionRow({ q }: { q: Question }) {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const asker = room.players.find((p) => p.id === q.askerId);

  return (
    <li className="flex items-start gap-2.5 py-2.5">
      {asker && (
        <span className="mt-1.5">
          <SeatDot seatNo={asker.seatNo} size={7} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm leading-relaxed text-ink">{q.text}</p>
        <div className="mt-0.5 text-[11px]">
          {asker ? <PlayerTag player={asker} dim /> : <span className="text-muted">—</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {q.answer ? (
          <>
            <AnswerMark answer={q.answer} />
            {q.corrected && q.previousAnswer && (
              <span className="text-[10px] text-muted line-through">
                {t('ui', 'play.correctedFrom')} {t('answer', q.previousAnswer)}
              </span>
            )}
          </>
        ) : (
          <span className="text-[11px] text-muted">{t('ui', 'play.waitingJudge')}</span>
        )}
      </div>
    </li>
  );
}

/** 队列与历史**全房可见** —— co-op 共享同一条推理链,迟到的人没有信息差。 */
function Stream() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const all = [...room.history, ...room.queue];

  return (
    <Panel className="p-5">
      <div className="flex items-baseline justify-between">
        <Kicker>{t('ui', 'play.stream')}</Kicker>
        {room.queue.length > 0 && (
          <span className="text-xs text-muted">
            {t('ui', 'play.queue')} {room.queue.length}
          </span>
        )}
      </div>
      {all.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('ui', 'play.streamEmpty')}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line/60">
          {all.map((q) => (
            <QuestionRow key={q.id} q={q} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ══════════════════════════ guesser 侧 ══════════════════════════ */

function GuesserControls() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const { askQuestion } = useRoomStore();
  const [text, setText] = useState('');

  const noBudget = room.budgetLeft !== null && room.budgetLeft <= 0;
  const capped = room.myPendingLeft <= 0;
  const blocked = noBudget || capped;

  const send = () => {
    if (!text.trim() || blocked) return;
    askQuestion(text);
    setText('');
  };

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          value={text}
          disabled={blocked}
          maxLength={JUDGING_LIMITS.questionMax}
          placeholder={t('ui', 'play.askPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <Button variant="solid" disabled={blocked || !text.trim()} onClick={send}>
          {t('ui', 'play.ask')}
        </Button>
      </div>
      {/* 被挡住时说清是哪一道闸 —— 额度和 pending cap 是两套账 */}
      {blocked && (
        <p className="mt-2 text-xs text-muted">
          {noBudget ? t('ui', 'play.budgetOut') : t('ui', 'play.pendingBlocked')}
        </p>
      )}
      <SubmitSolution />
    </Panel>
  );
}

/** 海龟汤的独立还原通道。**不占 pending cap**。 */
function SubmitSolution() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const { submitSolution } = useRoomStore();
  const [text, setText] = useState('');

  // guess 入口的分支依据:config 表的 guessMode,不是 puzzleType。
  if (puzzleConfig(room.settings.puzzleType).guessMode !== 'submission') return null;

  const mine = room.submissions.find((s) => s.playerId === room.viewerId && s.status === 'pending');

  return (
    <div className="mt-4 border-t border-line/60 pt-4">
      <Kicker>{t('ui', 'play.submit')}</Kicker>
      <TextArea
        className="mt-2"
        rows={3}
        value={text}
        disabled={!!mine}
        maxLength={JUDGING_LIMITS.submissionMax}
        placeholder={t('ui', 'play.submitPlaceholder')}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        className="mt-2 w-full sm:w-auto"
        disabled={!!mine || !text.trim()}
        onClick={() => {
          submitSolution(text);
          setText('');
        }}
      >
        {t('ui', 'play.submit')}
      </Button>
    </div>
  );
}

/* ══════════════════════════ oracle 侧 ══════════════════════════ */

/** 判定按钮组 —— **照 config 表的 `answers` 渲染**。加一个类型这里一行不改。 */
function JudgeButtons({ onPick }: { onPick: (a: Answer) => void }) {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const answers = puzzleConfig(room.settings.puzzleType).answers;

  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {answers.map((a) => (
        <Button
          key={a}
          // ★ 命中态是三焦点之一 —— 只有它用琥珀实心(DECISIONS #6)
          variant={a === 'CORRECT' ? 'focus' : 'ghost'}
          onClick={() => onPick(a)}
          className="justify-center"
        >
          {a === 'CORRECT' ? (
            <span>
              <b className="mr-1">{ANSWER_ICON[a]}</b>
              {t('answer', a)}
            </span>
          ) : (
            <AnswerMark answer={a} />
          )}
        </Button>
      ))}
    </div>
  );
}

function OracleControls() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const { judge, correctLast } = useRoomStore();
  const head = room.queue[0] ?? null;
  const last = room.history[room.history.length - 1] ?? null;
  const [correcting, setCorrecting] = useState(false);

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <Kicker>{t('ui', 'play.judgeHead')}</Kicker>
        {room.queue.length > 1 && (
          <span className="text-xs text-muted">
            {t('ui', 'play.queue')} {room.queue.length}
          </span>
        )}
      </div>

      {head ? (
        <>
          {/* 严格判队首 —— 只显示这一条,不给挑的机会 */}
          <p className="mt-2 break-words text-base leading-relaxed text-ink">{head.text}</p>
          <div className="mt-1 text-[11px]">
            <PlayerTagById id={head.askerId} dim />
          </div>
          <div className="mt-3">
            <JudgeButtons onPick={(a) => judge(a)} />
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">{t('ui', 'play.noPending')}</p>
      )}

      {/* 改判:仅最近一条,仅一次 */}
      {last && !last.corrected && (
        <div className="mt-4 border-t border-line/60 pt-4">
          {correcting ? (
            <>
              <p className="mb-2 break-words text-xs text-muted">{last.text}</p>
              <JudgeButtons
                onPick={(a) => {
                  correctLast(a);
                  setCorrecting(false);
                }}
              />
              <Button className="mt-2" onClick={() => setCorrecting(false)}>
                {t('ui', 'play.cancel')}
              </Button>
            </>
          ) : (
            <Button className="text-xs" onClick={() => setCorrecting(true)}>
              {t('ui', 'play.correctLast')}
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

/** 还原提交卡片 —— 独立于队列呈现,oracle 可优先处理(SPEC §5)。 */
function Submissions() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const isOracle = useIsOracle();
  const { resolveSubmission } = useRoomStore();

  if (room.submissions.length === 0) return null;

  return (
    <Panel className="p-5">
      <Kicker>{t('ui', 'play.submissions')}</Kicker>
      <ul className="mt-2 divide-y divide-line/60">
        {room.submissions.map((s) => (
          <li key={s.id} className="py-3">
            {/* 内容全房可见 —— co-op 没有泄题问题。还原是叙事文本,走 serif */}
            <Narrative className="whitespace-pre-wrap break-words text-sm">{s.text}</Narrative>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px]">
                <PlayerTagById id={s.playerId} dim />
              </span>
              {s.status === 'accepted' && (
                <span className="text-[11px] text-judge-correct">★ {t('ui', 'play.accepted')}</span>
              )}
              {s.status === 'rejected' && (
                <span className="text-[11px] text-muted">{t('ui', 'play.rejected')}</span>
              )}
              {isOracle && s.status === 'pending' && (
                <span className="ml-auto flex gap-2">
                  {/* accept = 命中态,琥珀(DECISIONS #6) */}
                  <Button
                    variant="focus"
                    className="px-2.5 py-1 text-xs"
                    onClick={() => resolveSubmission(s.id, true)}
                  >
                    ★ {t('ui', 'play.accept')}
                  </Button>
                  <Button
                    className="px-2.5 py-1 text-xs"
                    onClick={() => resolveSubmission(s.id, false)}
                  >
                    {t('ui', 'play.reject')}
                  </Button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ══════════════════════════ 底部控制 ══════════════════════════ */

function FooterControls() {
  const isOracle = useIsOracle();
  const isHost = useIsHost();
  if (!isOracle && !isHost) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-3 border-t border-line/50 pt-4">
      {isHost && <TransferOracle />}
      {isOracle && <RevealTruthButton />}
    </div>
  );
}

/** host 的中段接管入口(SPEC §7):换人不换题,牌局状态一概不动。 */
function TransferOracle() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const { assignOracle } = useRoomStore();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button className="px-2.5 py-1 text-xs" onClick={() => setOpen(true)}>
        {t('ui', 'oracle.transferTo')}
      </Button>
    );
  }
  return (
    <Panel className="w-full p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{t('ui', 'oracle.transferTo')}</span>
        {room.players
          .filter((p) => p.id !== room.oracleId)
          .map((p) => (
            <Button
              key={p.id}
              className="px-2.5 py-1 text-xs"
              onClick={() => {
                assignOracle(p.id);
                setOpen(false);
              }}
            >
              <PlayerTag player={p} showBadge={false} />
            </Button>
          ))}
        <Button className="ml-auto px-2.5 py-1 text-xs" onClick={() => setOpen(false)}>
          {t('ui', 'play.cancel')}
        </Button>
      </div>
    </Panel>
  );
}

/** 公开汤底 —— **必须先确认**(SPEC §5 防误触)。 */
function RevealTruthButton() {
  const t = useT();
  const { revealTruth } = useRoomStore();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={() => setConfirming(true)}>
        {t('ui', 'play.revealTruth')}
      </Button>
    );
  }
  return (
    <Panel className="w-full border-judge-no/50 p-5 text-center">
      <p className="text-sm text-ink">{t('ui', 'play.revealConfirm')}</p>
      <div className="mt-3 flex justify-center gap-3">
        <Button onClick={() => setConfirming(false)}>{t('ui', 'play.cancel')}</Button>
        <Button variant="danger" onClick={revealTruth}>
          {t('ui', 'play.confirm')}
        </Button>
      </div>
    </Panel>
  );
}
