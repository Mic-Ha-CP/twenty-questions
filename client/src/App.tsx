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
import { Kicker, Panel } from '@/components/ui';
import Landing from '@/screens/Landing';
import Lobby from '@/screens/Lobby';
import Setup from '@/screens/Setup';
import { useLangStore, useT } from '@/store/langStore';
import { useRoomStore, wireRoomSocket } from '@/store/roomStore';

export default function App() {
  const t = useT();
  const { lang, setLang } = useLangStore();
  const { conn, room, error, clearError } = useRoomStore();

  useEffect(() => wireRoomSocket(), []);

  // 错误提示自己消失 —— 不做一个需要点掉的模态
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(clearError, 3200);
    return () => clearTimeout(id);
  }, [error, clearError]);

  return (
    <div className="relative min-h-full bg-vault">
      {conn !== 'online' && (
        <div className="sticky top-0 z-20 bg-judge-no/15 py-1.5 text-center text-xs text-ink">
          {t('ui', `conn.${conn}`)}
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
    case 'reveal':
      return <NotBuiltYet />;
  }
}

/**
 * playing / reveal 的占位。
 * 判定循环(SPEC §5)与 reveal 交接(SPEC §3)是下一刀的活 ——
 * 故意留个明显的空壳,而不是画一个假的界面。
 */
function NotBuiltYet() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-4 px-6 py-16">
      <Panel className="p-6 text-center">
        <Kicker>{t('phase', room.phase)}</Kicker>
        <p className="mt-3 text-sm text-muted">
          判定循环还没开工 —— 见 docs/ROADMAP.md Phase 1。
        </p>
      </Panel>
    </div>
  );
}
