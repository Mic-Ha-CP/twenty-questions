/**
 * ⚠️ **这不是一个屏。** 本 session 明确不做任何游戏屏(Landing / Lobby / Setup /
 * Playing / Reveal 都属于后续 session)。
 *
 * 这里只是一块 scaffold 状态板,用来证明工具链是通的:
 * React 18 渲染 / Tailwind 的 1c token 生效 / socket 连得上 / strings + lang store 能用。
 *
 * **下一个 session 的第一件事就是把它整个换掉**,换成 SPEC §9 的 Landing
 * (勘误后:直接就是「建房 / 加入」,**没有 nickname 输入框**)。
 */

import { useEffect, useState } from 'react';
import { GAME_META } from '@shared/meta';
import { PUZZLE_TYPE_IDS } from '@shared/puzzleTypes';
import { getIdentity } from '@/lib/nickname';
import { ANSWER_ICON } from '@/lib/strings';
import { useLangStore, useT } from '@/store/langStore';
import { getSocket } from '@/lib/socket';

type Conn = 'connecting' | 'online' | 'offline';

export default function App() {
  const t = useT();
  const { lang, setLang } = useLangStore();
  const [conn, setConn] = useState<Conn>('connecting');
  const [identity] = useState(getIdentity);

  useEffect(() => {
    const s = getSocket();
    const on = () => setConn('online');
    const off = () => setConn('offline');
    s.on('connect', on);
    s.on('disconnect', off);
    if (s.connected) setConn('online');
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
    };
  }, []);

  return (
    <div className="min-h-full bg-vault">
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
        <header>
          <div className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            {GAME_META.gameId}
          </div>
          <h1 className="mt-3 font-serif text-3xl text-ink">{t('ui', 'app.title')}</h1>
          <p className="mt-2 text-sm text-muted">
            scaffold only — 房间层 + oracle 座位 + phase 骨架。游戏屏尚未开工。
          </p>
        </header>

        <section className="rounded border border-line bg-panel p-5 text-sm shadow-panel">
          <Row label="连接" value={t('ui', `conn.${conn}`)} />
          <Row label="playerId" value={identity.playerId.slice(0, 8)} mono />
          <Row label="显示名(静默生成)" value={identity.nickname} />
          <Row label="puzzle types" value={PUZZLE_TYPE_IDS.join(' · ')} mono />
        </section>

        <section className="rounded border border-line bg-panel p-5 shadow-panel">
          <div className="mb-3 text-xs uppercase tracking-wider text-muted">判定图例(双编码)</div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Chip icon={ANSWER_ICON.YES} label={t('answer', 'YES')} cls="text-judge-yes" />
            <Chip icon={ANSWER_ICON.NO} label={t('answer', 'NO')} cls="text-judge-no" />
            <Chip
              icon={ANSWER_ICON.IRRELEVANT}
              label={t('answer', 'IRRELEVANT')}
              cls="text-judge-irrelevant"
            />
            <Chip icon={ANSWER_ICON.BOTH} label={t('answer', 'BOTH')} cls="text-judge-both" />
            <Chip
              icon={ANSWER_ICON.UNCLEAR}
              label={t('answer', 'UNCLEAR')}
              cls="text-judge-unclear"
            />
            <Chip
              icon={ANSWER_ICON.CORRECT}
              label={t('answer', 'CORRECT')}
              cls="text-judge-correct"
            />
          </div>
        </section>

        <button
          type="button"
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          className="self-start rounded border border-line px-3 py-1.5 text-xs text-ctrl hover:border-accent hover:text-accent"
        >
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line/60 py-1.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className={mono ? 'font-mono text-ctrl' : 'text-ink'}>{value}</span>
    </div>
  );
}

function Chip({ icon, label, cls }: { icon: string; label: string; cls: string }) {
  return (
    <span className={`rounded-full border border-line px-2.5 py-1 ${cls}`}>
      <b className="mr-1">{icon}</b>
      {label}
    </span>
  );
}
