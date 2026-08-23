/**
 * Reveal —— 揭晓屏(SPEC §3)。
 *
 * 这是 1c 皮第一个**完整**的屏。琥珀纪律照 DECISIONS #6:
 *   · **真相区**用琥珀 —— 它是这一屏的「汤面区」等价物,是全屏的视觉重心;
 *   · **结果行的 ★ 命中**用琥珀 —— 命中态,三焦点之一;
 *   · 其余一律不许用。未猜中的两种结局(额度耗尽 / oracle 公开)**不带琥珀** ——
 *     没猜中就不该有高光。
 *
 * 数据来源:**全部来自已有状态,不新增持久面。**
 *   · 结果 / 命中者 / 共用几问 / 用时 / 真相 → `outcome` 快照;
 *   · 命中的那条问题或还原 → 从 `history` / `submissions` 里按 `outcome.via` 找
 *     (reveal 期间它们还在;归位发生在离开 reveal 时)。
 */

import type { RoundOutcome } from '@shared/judging';
import { PlayerTag } from '@/components/player';
import { RoomHeader, ScreenShell } from '@/components/RoomHeader';
import { Button, Kicker, Narrative, Panel } from '@/components/ui';
import { ANSWER_ICON } from '@/lib/strings';
import { useIsHost, useRoomStore } from '@/store/roomStore';
import { useT } from '@/store/langStore';

export default function Reveal() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const isHost = useIsHost();
  const { startNextRound, backToLobby } = useRoomStore();
  const outcome = room.outcome;

  return (
    <ScreenShell>
      <RoomHeader compact />
      <ResultLine outcome={outcome} />
      <TruthPanel outcome={outcome} />
      <HitDetail outcome={outcome} />
      <NextOracleRow />

      {isHost ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="solid" className="flex-1" onClick={startNextRound}>
            {t('ui', 'reveal.nextRound')}
          </Button>
          <Button className="flex-1" onClick={backToLobby}>
            {t('ui', 'reveal.backToLobby')}
          </Button>
        </div>
      ) : (
        <p className="text-center text-xs text-muted">{t('ui', 'play.waitingJudge')}</p>
      )}
    </ScreenShell>
  );
}

/** 结果行。**只有命中才配琥珀 + ★**;没猜中的两种结局收着来。 */
function ResultLine({ outcome }: { outcome: RoundOutcome | null }) {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  if (!outcome) return null;

  const hit = outcome.result === 'hit';
  const winner = room.players.find((p) => p.id === outcome.winnerId);

  return (
    <div className="text-center">
      <div className={hit ? 'text-accent' : 'text-muted'}>
        {hit && <span className="mr-1.5">{ANSWER_ICON.CORRECT}</span>}
        <span className="text-lg">{t('ui', `reveal.${outcome.result}`)}</span>
      </div>

      {winner && (
        <div className="mt-1.5 flex items-center justify-center gap-1.5 text-sm text-ink">
          <span>{t('ui', 'reveal.winner')}:</span>
          <PlayerTag player={winner} />
        </div>
      )}

      {/* co-op 是群体胜利 —— 共用几问放在这里,和「谁问出来的」同级,不是个人战绩 */}
      <p className="mt-2 font-mono text-xs text-muted">
        {t('ui', 'reveal.questionsUsed')} {outcome.questionsUsed} · {t('ui', 'reveal.duration')}{' '}
        {formatDuration(outcome.durationMs)}
      </p>
    </div>
  );
}

/** 真相区 —— 本屏的「汤面区」等价物,琥珀名正言顺(DECISIONS #6)。 */
function TruthPanel({ outcome }: { outcome: RoundOutcome | null }) {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  if (!outcome) return null;

  return (
    <Panel className="border-accent/40 p-6">
      <Kicker>{t('ui', 'reveal.truth')}</Kicker>
      {room.puzzle?.title && <div className="mt-2 text-sm text-accent">{room.puzzle.title}</div>}
      {/* serif 只给叙事文本 —— 汤底就是叙事文本 */}
      <Narrative className="mt-3 text-lg">{outcome.truth}</Narrative>
    </Panel>
  );
}

/**
 * 命中的那条问题 / 还原。
 * **不新增字段** —— 按 `outcome.via` 去现有的 history / submissions 里找。
 */
function HitDetail({ outcome }: { outcome: RoundOutcome | null }) {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  if (!outcome || outcome.result !== 'hit') return null;

  if (outcome.via === 'judgment') {
    const q = room.history.find((x) => x.answer === 'CORRECT');
    if (!q) return null;
    return (
      <Panel className="p-5">
        <Kicker>{t('ui', 'reveal.hitQuestion')}</Kicker>
        <p className="mt-2 break-words text-sm text-ink">
          <span className="mr-1.5 text-judge-correct">{ANSWER_ICON.CORRECT}</span>
          {q.text}
        </p>
      </Panel>
    );
  }

  const sub = room.submissions.find((x) => x.status === 'accepted');
  if (!sub) return null;
  return (
    <Panel className="p-5">
      <Kicker>{t('ui', 'reveal.hitSubmission')}</Kicker>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{sub.text}</p>
    </Panel>
  );
}

/**
 * 「下一局出题人」行(SPEC §3)。
 * 默认值由 server 按策略定(猜中者接棒 / 未猜中 oracle 连任),**host 可改**。
 * 全房可见 —— 交接结果不该只有 host 知道。
 */
function NextOracleRow() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const isHost = useIsHost();
  const { setNextOracle } = useRoomStore();

  const next = room.players.find((p) => p.id === room.nextOracleId);

  return (
    <Panel className="p-5">
      <div className="flex items-baseline justify-between">
        <Kicker>{t('ui', 'reveal.nextOracle')}</Kicker>
        <span className="text-sm text-ink">
          {next ? (
            <PlayerTag player={next} />
          ) : (
            <span className="text-judge-unclear">{t('ui', 'seat.empty')}</span>
          )}
        </span>
      </div>

      {isHost && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
          <span className="text-xs text-muted">{t('ui', 'reveal.change')}</span>
          {room.players
            .filter((p) => p.id !== room.nextOracleId)
            .map((p) => (
              <Button key={p.id} className="px-2.5 py-1 text-xs" onClick={() => setNextOracle(p.id)}>
                <PlayerTag player={p} showBadge={false} />
              </Button>
            ))}
          {room.nextOracleId !== null && (
            <Button className="px-2.5 py-1 text-xs" onClick={() => setNextOracle(null)}>
              {t('ui', 'reveal.noOracle')}
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}
