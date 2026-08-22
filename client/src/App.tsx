/**
 * Phase 路由 + 全局外壳。
 *
 *   没进房          → Landing(**直接就是建房/加入,无 nickname 框**,ADR-10)
 *   lobby           → Lobby
 *   setup           → Setup(双视角)
 *   playing/reveal  → 空壳,等判定循环那一刀
 *
 * 错误只拿到语义 code,中文在 strings.ts 里查(SPEC §8)——
 * 这一层不认识任何 server 发来的展示字符串,因为 server 根本不发。
 */

import { useEffect } from 'react';
import Landing from '@/screens/Landing';
import Lobby from '@/screens/Lobby';
import Playing from '@/screens/Playing';
import Reveal from '@/screens/Reveal';
import Setup from '@/screens/Setup';
import { useLangStore, useT } from '@/store/langStore';
import { useRoomStore, wireRoomSocket } from '@/store/roomStore';

export default function App() {
  const t = useT();
  const { lang, setLang } = useLangStore();
  const { conn, ready, room, error, clearError } = useRoomStore();

  useEffect(() => wireRoomSocket(), []);

  // 错误提示自己消失 —— 不做一个需要点掉的模态
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(clearError, 3200);
    return () => clearTimeout(id);
  }, [error, clearError]);

  return (
    <div className="relative min-h-full bg-vault">
      {/*
        条件是 `!ready` 而不是 `conn !== 'online'`:连上到收到 s:hello_ok 之间
        还有一个窗口,那段时间点按钮只会被排队。宁可多显示一瞬,不要假装能用。
      */}
      {!ready && (
        <div className="sticky top-0 z-20 bg-judge-no/15 py-1.5 text-center text-xs text-ink">
          {t('ui', conn === 'online' ? 'conn.identifying' : `conn.${conn}`)}
        </div>
      )}

      {!room ? <Landing /> : <PhaseScreen />}

      {error && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center px-6">
          <div className="rounded border border-judge-no/50 bg-panel px-4 py-2 text-sm text-ink shadow-panel">
            {t('error', error)}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
        className="fixed bottom-4 right-4 rounded border border-line px-2.5 py-1 text-[11px] text-muted hover:border-ctrl hover:text-ink"
      >
        {lang === 'zh' ? 'EN' : '中文'}
      </button>
    </div>
  );
}

function PhaseScreen() {
  const room = useRoomStore((s) => s.room)!;
  switch (room.phase) {
    case 'lobby':
      return <Lobby />;
    case 'setup':
      return <Setup />;
    case 'playing':
      return <Playing />;
    case 'reveal':
      return <Reveal />;
  }
}
