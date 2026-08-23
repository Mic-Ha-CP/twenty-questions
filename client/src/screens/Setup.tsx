/**
 * Setup —— **双视角屏**(SPEC §3 / §6)。
 *
 * 这是 SPEC §4 允许 client 分支渲染的**三处之一**:题库列表 vs 单行输入。
 * 分支依据是 config 表的 `hasBank`,**不是** `puzzleType === 'situation'`。
 *
 * 防剧透在这里只负责「不去显示」;真正的遮蔽在 server 的 `toClientState` ——
 * guesser 的 payload 里压根没有 `oracleTruth` 和 `bank`,不是前端藏起来。
 *
 * 三焦点里的「汤面区」在这里:`SurfacePanel` 是本屏唯一允许用琥珀的地方。
 */

import { useEffect, useState } from 'react';
import { puzzleConfig } from '@shared/puzzleTypes';
import { PUZZLE_LIMITS } from '@shared/puzzles';
import { RoomHeader, ScreenShell } from '@/components/RoomHeader';
import { Button, Difficulty, Field, Kicker, Narrative, Panel, Tag, TextArea, TextInput } from '@/components/ui';
import { useIsOracle, useRoomStore } from '@/store/roomStore';
import { useT } from '@/store/langStore';

export default function Setup() {
  return useIsOracle() ? <OracleSetup /> : <GuesserSetup />;
}

/* ══════════════════════════ 汤面区(三焦点之一)══════════════════════════ */

function SurfacePanel({ title, surface }: { title: string | null; surface: string }) {
  const t = useT();
  return (
    <Panel className="border-accent/40 p-6">
      <Kicker>{t('ui', 'setup.surface')}</Kicker>
      {title && <div className="mt-2 text-sm text-accent">{title}</div>}
      {/* serif 只给叙事文本 —— 汤面就是叙事文本 */}
      <Narrative className="mt-3 text-lg">{surface}</Narrative>
    </Panel>
  );
}

/* ══════════════════════════ guesser 视角 ══════════════════════════ */

function GuesserSetup() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const puzzle = room.puzzle;

  return (
    <ScreenShell>
      <RoomHeader />
      {puzzle?.surface ? (
        <>
          <SurfacePanel title={puzzle.title} surface={puzzle.surface} />
          <p className="text-center text-sm text-muted">{t('ui', 'setup.surfacePublic')}</p>
        </>
      ) : (
        <div className="text-center">
          <Kicker>{t('ui', 'setup.guesserTitle')}</Kicker>
          <p className="mt-4 text-sm text-muted">
            {puzzle ? t('ui', 'setup.wordHeld') : t('ui', 'setup.guesserWait')}
          </p>
        </div>
      )}
    </ScreenShell>
  );
}

/* ══════════════════════════ oracle 视角 ══════════════════════════ */

function OracleSetup() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  // 唯一的分流依据:config 表。不判 puzzleType。
  const hasBank = puzzleConfig(room.settings.puzzleType).hasBank;

  return (
    <ScreenShell>
      <RoomHeader />
      <header>
        <Kicker>{t('ui', 'setup.oracleTitle')}</Kicker>
      </header>
      {room.puzzle ? <PuzzleReady hasBank={hasBank} /> : hasBank ? <BankOrOwn /> : <AnswerWord />}
    </ScreenShell>
  );
}

/** 题已录好:汤面公开、汤底在手,可以换一题或开汤。 */
function PuzzleReady({ hasBank }: { hasBank: boolean }) {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const { clearPuzzle, beginPlaying } = useRoomStore();
  const puzzle = room.puzzle!;

  return (
    <>
      {puzzle.surface && <SurfacePanel title={puzzle.title} surface={puzzle.surface} />}

      {/* 汤底 / 答案词 —— 只有 oracle 的 payload 里有这个字段 */}
      <Panel className="p-5">
        <Kicker>{hasBank ? t('ui', 'setup.truth') : t('ui', 'setup.answerWord')}</Kicker>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {room.oracleTruth}
        </p>
        <p className="mt-3 text-[11px] text-muted">
          {hasBank ? t('ui', 'setup.truthHeld') : t('ui', 'setup.wordHeld')}
        </p>
      </Panel>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button onClick={clearPuzzle} className="flex-1">
          {t('ui', 'setup.another')}
        </Button>
        <Button variant="solid" onClick={beginPlaying} className="flex-1">
          {hasBank ? t('ui', 'setup.openSoup') : t('ui', 'setup.lockWord')}
        </Button>
      </div>
    </>
  );
}

/** 海龟汤:题库选题 或 自己写。 */
function BankOrOwn() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const { selectBankPuzzle } = useRoomStore();
  const bank = room.bank ?? [];
  const [tab, setTab] = useState<'bank' | 'own'>(room.bankExhausted ? 'own' : 'bank');

  return (
    <>
      <div className="flex gap-2">
        <Button
          variant={tab === 'bank' ? 'solid' : 'ghost'}
          disabled={room.bankExhausted}
          onClick={() => setTab('bank')}
        >
          {t('ui', 'setup.chooseFromBank')}
        </Button>
        <Button variant={tab === 'own' ? 'solid' : 'ghost'} onClick={() => setTab('own')}>
          {t('ui', 'setup.writeOwn')}
        </Button>
      </div>

      {tab === 'bank' ? (
        <Panel className="p-2">
          {bank.length === 0 ? (
            <p className="p-4 text-sm text-muted">{t('ui', 'setup.bankEmpty')}</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {/* 防剧透:列表只有 title + tags/difficulty —— server 也只发了这些 */}
              {bank.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3">
                  <span className="text-sm text-ink">{p.title}</span>
                  <Difficulty level={p.difficulty} />
                  <span className="flex flex-wrap gap-1.5">
                    {p.tags?.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </span>
                  <Button className="ml-auto" onClick={() => selectBankPuzzle(p.id)}>
                    {t('ui', 'setup.confirm')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <OwnPuzzleForm />
      )}
    </>
  );
}

/** 自写题:汤面 + 汤底两栏(SPEC §6)。 */
function OwnPuzzleForm() {
  const t = useT();
  const { setCustomPuzzle } = useRoomStore();
  const [title, setTitle] = useState('');
  const [surface, setSurface] = useState('');
  const [truth, setTruth] = useState('');

  const ready = surface.trim().length > 0 && truth.trim().length > 0;

  return (
    <Panel className="flex flex-col gap-4 p-5">
      <Field label={t('ui', 'setup.title')}>
        <TextInput
          value={title}
          maxLength={PUZZLE_LIMITS.titleMax}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field label={t('ui', 'setup.surface')} hint={`${surface.length}/${PUZZLE_LIMITS.surfaceMax}`}>
        <TextArea
          rows={4}
          value={surface}
          maxLength={PUZZLE_LIMITS.surfaceMax}
          onChange={(e) => setSurface(e.target.value)}
        />
      </Field>
      <Field label={t('ui', 'setup.truth')} hint={`${truth.length}/${PUZZLE_LIMITS.truthMax}`}>
        <TextArea
          rows={5}
          value={truth}
          maxLength={PUZZLE_LIMITS.truthMax}
          onChange={(e) => setTruth(e.target.value)}
        />
      </Field>
      <Button
        variant="solid"
        disabled={!ready}
        onClick={() => setCustomPuzzle({ surface, truth, title: title || null })}
      >
        {t('ui', 'setup.confirm')}
      </Button>
    </Panel>
  );
}

/** 20Q:单行答案词 + 随机建议(建议词表**不是题库**)。 */
function AnswerWord() {
  const t = useT();
  const { setCustomPuzzle, suggestAnswerWord, clearSuggestion } = useRoomStore();
  const suggestion = useRoomStore((s) => s.suggestion);
  const [word, setWord] = useState('');

  // 建议词是点对点回来的,落进输入框后就该清掉,免得下次进来又被填一遍
  useEffect(() => {
    if (suggestion) {
      setWord(suggestion);
      clearSuggestion();
    }
  }, [suggestion, clearSuggestion]);

  return (
    <Panel className="flex flex-col gap-4 p-5">
      <Field label={t('ui', 'setup.answerWord')} hint={`≤ ${PUZZLE_LIMITS.answerWordMax}`}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            value={word}
            maxLength={PUZZLE_LIMITS.answerWordMax}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && word.trim()) setCustomPuzzle({ truth: word });
            }}
          />
          <Button onClick={() => suggestAnswerWord(word || undefined)}>
            {t('ui', 'setup.suggest')}
          </Button>
        </div>
      </Field>
      <Button
        variant="solid"
        disabled={!word.trim()}
        onClick={() => setCustomPuzzle({ truth: word })}
      >
        {t('ui', 'setup.confirm')}
      </Button>
    </Panel>
  );
}
