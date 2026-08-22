/**
 * Landing —— SPEC §9(b)(勘误后):**直接就是「建房 / 加入」。**
 *
 * ⚠️ **这里没有、也不许有 nickname 输入框**(ADR-10)。
 * 显示名由 `lib/nickname.ts` 静默生成;改名的入口在 lobby 里,不是进门的关卡。
 * 设计稿上的「报上你的名号,入局。」已被 SPEC 勘误作废(DECISIONS #5)。
 */

import { useEffect, useState } from 'react';
import { Button, Kicker, Narrative, Panel, TextInput } from '@/components/ui';
import { useRoomStore } from '@/store/roomStore';
import { useT } from '@/store/langStore';

export default function Landing() {
  const t = useT();
  const [code, setCode] = useState('');
  const { lobby, createRoom, joinRoom, subscribeLobby } = useRoomStore();

  useEffect(() => {
    subscribeLobby();
  }, [subscribeLobby]);

  const canJoin = /^\d{4}$/.test(code.trim());

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header className="text-center">
        <Kicker>{t('ui', 'landing.kicker')}</Kicker>
        <Narrative className="mt-5 text-3xl">{t('ui', 'landing.tagline')}</Narrative>
      </header>

      <div className="flex flex-col items-center gap-4">
        <Button variant="solid" className="px-6 py-3" onClick={() => createRoom(false)}>
          {t('ui', 'lobby.create')}
        </Button>

        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px w-10 bg-line" />
          {t('ui', 'lobby.or')}
          <span className="h-px w-10 bg-line" />
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canJoin) joinRoom(code.trim());
          }}
        >
          <TextInput
            value={code}
            inputMode="numeric"
            maxLength={4}
            placeholder={t('ui', 'landing.codePlaceholder')}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="w-40 text-center font-mono tracking-[0.3em]"
          />
          <Button type="submit" disabled={!canJoin}>
            {t('ui', 'lobby.join')}
          </Button>
        </form>
      </div>

      {/* 大厅列表:私密房不在这里(server 侧就过滤了,不是前端隐藏) */}
      <Panel className="p-5">
        <Kicker>{t('ui', 'lobby.list')}</Kicker>
        {lobby.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('ui', 'lobby.listEmpty')}</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-line/60">
            {lobby.map((r) => (
              <li key={r.code} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="font-mono text-muted">#{r.displayNumber}</span>
                <span className="text-ink">{t('puzzleType', r.puzzleType)}</span>
                <span className="text-muted">
                  {r.playerCount}/{r.maxPlayers}
                </span>
                {!r.hasOracle && (
                  <span className="text-[11px] text-judge-unclear">{t('ui', 'seat.empty')}</span>
                )}
                <span className="ml-auto text-muted">{t('phase', r.phase)}</span>
                <Button onClick={() => joinRoom(r.code)}>{t('ui', 'lobby.joinRow')}</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
