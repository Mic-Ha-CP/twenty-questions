/**
 * Playing —— 判定循环屏(SPEC §5)。双视角。
 *
 * 这是 SPEC §4 允许 client 分支渲染的**三处之二**:
 *   · 判定按钮组 —— 照 config 表的 `answers` 数组渲染,不判类型;
 *   · guess 入口 —— 20Q 没有摊牌按钮(猜测即提问);海龟汤有「提交还原」。
 * 依据都是 config 表,**不是** `puzzleType === ...`。
 *
 * 三焦点里的两个在这一屏(SPEC §9 / DECISIONS #6):
 *   · **额度计数**;
 *   · **命中态** —— ★ 就是它! 与海龟汤的「就是这样」,都用琥珀。
 *     它们填的是被 SPEC 删掉的「正式猜测」空出来的第三个名额。
 * 除此之外这一屏不许出现琥珀。
 */

import { useEffect, useState } from 'react';
import type { Question } from '@shared/judging';
import { JUDGING_LIMITS } from '@shared/judging';
import { puzzleConfig, type Answer } from '@shared/puzzleTypes';
import { Button, Kicker, Narrative, Panel, TextArea, TextInput } from '@/components/ui';
import { ANSWER_ICON, ANSWER_MARK_CLASS } from '@/lib/strings';
import { useIsHost, useIsOracle, useRoomStore } from '@/store/roomStore';
import { useT } from '@/store/langStore';

export default function Playing() {
  const room = useRoomStore((s) => s.room)!;
  const isOracle = useIsOracle();

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-5 px-6 py-10">
      {room.puzzle?.surface && (
        <Panel className="border-accent/40 p-6">
          {room.puzzle.title && <div className="mb-2 text-sm text-accent">{room.puzzle.title}</div>}
          <Narrative>{room.puzzle.surface}</Narrative>
        </Panel>
      )}

      <BudgetBar />
      <CorrectionNotice />
      <OracleTransferNotice />
      <Stream />
      {isOracle ? <OracleControls /> : <GuesserControls />}
      <Submissions />
      <TransferOracle />
      {isOracle && <RevealTruthButton />}
    </div>
  );
}

/* ══════════════════ 额度计数 —— 三焦点之一,可以用琥珀 ══════════════════ */

function BudgetBar() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  // 额度计数器**仅当 budget 非 null 时显示** —— 由 config 表决定(SPEC §4)。
  if (room.budgetLeft === null) return null;

  const out = room.budgetLeft <= 0;
  return (
    <div className="flex items-baseline justify-between rounded border border-line bg-panel px-4 py-2.5">
      <span className="text-xs text-muted">{t('ui', 'play.budget')}</span>
      <span className={`font-mono text-2xl ${out ? 'text-judge-no' : 'text-accent'}`}>
        {room.budgetLeft}
      </span>
    </div>
  );
}

/**
 * 判定更正提示。
 * 光靠 Q&A 流里那个小标记不够 —— 推理链被改写必须**当场**看得见(SPEC §5)。
 */
function CorrectionNotice() {
  const t = useT();
  const correction = useRoomStore((s) => s.correction);
  const clearCorrection = useRoomStore((s) => s.clearCorrection);

  useEffect(() => {
    if (!correction) return;
    const id = setTimeout(clearCorrection, 6000);
    return () => clearTimeout(id);
  }, [correction, clearCorrection]);

  if (!correction) return null;
  return (
    <div className="rounded border border-judge-unclear/50 bg-panel px-4 py-2 text-sm text-ink">
      {t('ui', 'play.corrected')}:{' '}
      {correction.from && <span className="text-muted">{t('answer', correction.from)}</span>}
      {' → '}
      {correction.to && <b>{t('answer', correction.to)}</b>}
    </div>
  );
}

/**
 * 出题人被转移的提示(SPEC §7 接管)。
 * 局中换判定的人是件大事 —— 光靠 `oracleId` 在 room_state 里悄悄变了,
 * 桌上的人不一定会注意到,而「谁在判」直接决定这条推理链还算不算数。
 */
function OracleTransferNotice() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const transfer = useRoomStore((s) => s.oracleTransfer);
  const clear = useRoomStore((s) => s.clearOracleTransfer);

  useEffect(() => {
    if (!transfer) return;
    const id = setTimeout(clear, 6000);
    return () => clearTimeout(id);
  }, [transfer, clear]);

  if (!transfer) return null;
  const to = room.players.find((p) => p.id === transfer.to);
  return (
    <div className="rounded border border-judge-unclear/50 bg-panel px-4 py-2 text-sm text-ink">
      {t('ui', 'oracle.transferred')}
      {to ? ` → ${to.nickname}` : ''}
    </div>
  );
}

/**
 * host 的中段接管入口(SPEC §7)。
 * oracle 掉线超宽限、或任何时刻 host 判断需要 —— 换个人接着判,题不变。
 * **必要接线而已**,视觉细调留下一刀。
 */
function TransferOracle() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const isHost = useIsHost();
  const { assignOracle } = useRoomStore();
  const [open, setOpen] = useState(false);

  if (!isHost) return null;

  if (!open) {
    return (
      <Button className="self-center px-2.5 py-1 text-xs" onClick={() => setOpen(true)}>
        {t('ui', 'oracle.transferTo')}
      </Button>
    );
  }
  return (
    <Panel className="p-4">
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
              {p.nickname}
            </Button>
          ))}
        <Button className="ml-auto px-2.5 py-1 text-xs" onClick={() => setOpen(false)}>
          {t('ui', 'play.cancel')}
        </Button>
      </div>
    </Panel>
  );
}

/* ══════════════════════════ 共享问答流 ══════════════════════════ */

function AnswerMark({ answer }: { answer: Answer }) {
  const t = useT();
  return (
    <span className={`whitespace-nowrap text-xs ${ANSWER_MARK_CLASS[answer]}`}>
      <b className="mr-1">{ANSWER_ICON[answer]}</b>
      {t('answer', answer)}
    </span>
  );
}

function QuestionRow({ q }: { q: Question }) {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const asker = room.players.find((p) => p.id === q.askerId);

  return (
    <li className="flex items-start gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-ink">{q.text}</p>
        <p className="mt-0.5 text-[11px] text-muted">
          {t('ui', 'play.by')} {asker?.nickname ?? '?'}
        </p>
      </div>
      {q.answer ? (
        <div className="flex flex-col items-end gap-1">
          <AnswerMark answer={q.answer} />
          {q.corrected && q.previousAnswer && (
            <span className="text-[10px] text-muted line-through">
              {t('ui', 'play.correctedFrom')} {t('answer', q.previousAnswer)}
            </span>
          )}
        </div>
      ) : (
        <span className="whitespace-nowrap text-[11px] text-muted">
          {t('ui', 'play.waitingJudge')}
        </span>
      )}
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
        <ul className="mt-2 divide-y divide-line/60">
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
    <Panel className="p-5">
      <div className="flex gap-2">
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
      {/* 被挡住时要说清是哪一道闸 —— 额度和 pending cap 是两套账 */}
      {blocked && (
        <p className="mt-2 text-xs text-muted">
          {noBudget ? t('ui', 'play.budgetOut') : t('ui', 'play.pendingBlocked')}
        </p>
      )}
      <SubmitSolution />
    </Panel>
  );
}

/** 海龟汤的独立还原通道。**不占 pending cap** —— 手上有未判问题也能交。 */
function SubmitSolution() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const { submitSolution } = useRoomStore();
  const [text, setText] = useState('');

  // guess 入口的分支依据:config 表的 guessMode,不是 puzzleType。
  if (puzzleConfig(room.settings.puzzleType).guessMode !== 'submission') return null;

  const mine = room.submissions.find(
    (s) => s.playerId === room.viewerId && s.status === 'pending',
  );

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
        className="mt-2"
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

/**
 * 判定按钮组 —— **照 config 表的 `answers` 渲染**。
 * 加一个 puzzle type,这里一行都不用改。
 */
function JudgeButtons({
  onPick,
  disabled,
}: {
  onPick: (a: Answer) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const answers = puzzleConfig(room.settings.puzzleType).answers;

  return (
    <div className="flex flex-wrap gap-2">
      {answers.map((a) => (
        <Button
          key={a}
          // 命中态是三焦点之一 —— ★ 就是它! 用琥珀实心(DECISIONS #6)
          variant={a === 'CORRECT' ? 'focus' : 'ghost'}
          disabled={disabled}
          onClick={() => onPick(a)}
        >
          <span className={a === 'CORRECT' ? '' : ANSWER_MARK_CLASS[a]}>
            <b className="mr-1">{ANSWER_ICON[a]}</b>
            {t('answer', a)}
          </span>
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
    <Panel className="p-5">
      <Kicker>{t('ui', 'play.judgeHead')}</Kicker>
      {head ? (
        <>
          {/* 严格判队首 —— 只显示这一条,不给挑的机会 */}
          <p className="mt-2 break-words text-base text-ink">{head.text}</p>
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
            <Button onClick={() => setCorrecting(true)}>{t('ui', 'play.correctLast')}</Button>
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
        {room.submissions.map((s) => {
          const who = room.players.find((p) => p.id === s.playerId);
          return (
            <li key={s.id} className="py-3">
              {/* 内容全房可见 —— co-op 没有泄题问题 */}
              <p className="break-words text-sm text-ink">{s.text}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[11px] text-muted">
                  {t('ui', 'play.by')} {who?.nickname ?? '?'}
                </span>
                {s.status === 'accepted' && (
                  <span className="text-[11px] text-judge-correct">
                    ★ {t('ui', 'play.accepted')}
                  </span>
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
          );
        })}
      </ul>
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
      <Button variant="danger" className="self-center" onClick={() => setConfirming(true)}>
        {t('ui', 'play.revealTruth')}
      </Button>
    );
  }
  return (
    <Panel className="border-judge-no/50 p-5 text-center">
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
