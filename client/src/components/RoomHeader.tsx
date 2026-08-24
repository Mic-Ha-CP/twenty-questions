/**
 * 房间顶条 —— 稿 #2a 每一屏都有的那一行:房间码 + 玩法 + 角色 + 在座的人。
 *
 * 抽成组件是因为它必须**四屏一致**(Lobby / Setup / Playing / Reveal);
 * 各屏各画一遍就会慢慢长歪。
 *
 * 琥珀纪律:这一条**完全中性**。房间码不是三焦点,别给它高光。
 * 唯一的例外是 20Q 的额度计数 —— 那是三焦点之一,由 `BudgetPill` 单独承担。
 */

import { PlayerStrip } from '@/components/player';
import {
  HostOfflineBanner,
  HostTransferNotice,
  LangToggle,
  LeaveRoomButton,
} from '@/components/RoomControls';
import { useRoomStore } from '@/store/roomStore';
import { useT } from '@/store/langStore';

export function RoomHeader({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const isOracle = room.oracleId === room.viewerId;

  return (
    <header className="sticky top-0 z-10 -mx-4 mb-1 border-b border-line/70 bg-bg/92 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm tracking-[0.18em] text-ctrl">{room.code}</span>
        <span className="text-xs text-muted">{t('puzzleType', room.settings.puzzleType)}</span>
        {isOracle && <span className="text-xs text-ctrl">· {t('ui', 'seat.youAreOracle')}</span>}
        <span className="ml-auto flex items-center gap-2">
          <BudgetPill />
          {/* 常驻:每一屏都能离开、每一屏都能切语言 */}
          <LeaveRoomButton />
          <LangToggle />
        </span>
      </div>
      {!compact && (
        <div className="mt-2">
          <PlayerStrip />
        </div>
      )}
      <div className="mt-2 flex flex-col gap-1.5 empty:mt-0">
        <HostOfflineBanner />
        <HostTransferNotice />
      </div>
    </header>
  );
}

/**
 * 额度计数 —— **三焦点之一,琥珀名正言顺**(SPEC §9 / DECISIONS #6)。
 * 仅当 `budgetLeft !== null` 时出现,由 config 表决定,不判类型。
 */
export function BudgetPill() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  if (room.budgetLeft === null) return null;

  const total = room.settings.budget;
  const out = room.budgetLeft <= 0;

  return (
    <span
      className="inline-flex items-baseline gap-1 font-mono text-sm"
      title={t('ui', 'play.budget')}
    >
      {/* 额度是三焦点之一,常态就用琥珀;归零时改判定红 —— 那已经不是「还剩多少」了 */}
      <span className={out ? 'text-judge-no' : 'text-accent'}>{room.budgetLeft}</span>
      {total !== null && <span className="text-xs text-muted">/{total}</span>}
    </span>
  );
}

/** 各屏共用的外壳:统一宽度、内边距、窄屏留白。375px 下不横向溢出。 */
export function ScreenShell({
  children,
  center = false,
  wide = false,
}: {
  children: React.ReactNode;
  center?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`mx-auto flex min-h-full w-full flex-col gap-4 px-4 pb-16 pt-4 sm:px-6 ${
        wide ? 'max-w-3xl' : 'max-w-2xl'
      } ${center ? 'justify-center' : ''}`}
    >
      {children}
    </div>
  );
}
