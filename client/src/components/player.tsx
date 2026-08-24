/**
 * 玩家身份三件套的渲染件(session 5 smoke 带回的修正 3)。
 *
 *   颜色点 · 名字 · 序号徽章 · 「你」标记
 *   例:  ● 可爱的土豆 ③ ·你
 *
 * **同一个人在玩家列表和 Q&A 流里必须长得一样** —— 这就是把它抽成组件的理由。
 * 颜色由 `seatNo` 派生(`lib/seats.ts`),中性色盘、禁琥珀。
 */

import type { Player } from '@shared/types';
import { seatBadge, seatColor } from '@/lib/seats';
import { useT } from '@/store/langStore';
import { useRoomStore } from '@/store/roomStore';

/** 纯色点。Q&A 流里靠它一眼认人,不用读名字。 */
export function SeatDot({ seatNo, size = 8 }: { seatNo: number; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: seatColor(seatNo) }}
    />
  );
}

/**
 * 一个人的标准写法。
 * `dim` 用于次要位置(Q&A 流的落款),避免和正文抢注意力。
 */
export function PlayerTag({
  player,
  dim = false,
  showBadge = true,
}: {
  player: Pick<Player, 'id' | 'nickname' | 'seatNo'>;
  dim?: boolean;
  showBadge?: boolean;
}) {
  const t = useT();
  const viewerId = useRoomStore((s) => s.room?.viewerId);
  const isMe = player.id === viewerId;

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <SeatDot seatNo={player.seatNo} size={dim ? 6 : 8} />
      <span className={`truncate ${dim ? 'text-muted' : 'text-ink'}`}>{player.nickname}</span>
      {showBadge && (
        <span className="shrink-0 font-mono text-[11px] text-muted">{seatBadge(player.seatNo)}</span>
      )}
      {/* 「你」标记:全 UI 一致,不在某些屏上省略 */}
      {isMe && <span className="shrink-0 text-[11px] text-ctrl">·{t('ui', 'lobby.you')}</span>}
    </span>
  );
}

/** 按 id 找人再渲染;找不到就退化成一个占位,不崩。 */
export function PlayerTagById({ id, dim = false }: { id: string | null; dim?: boolean }) {
  const player = useRoomStore((s) => s.room?.players.find((p) => p.id === id));
  if (!player) return <span className="text-muted">—</span>;
  return <PlayerTag player={player} dim={dim} />;
}

/**
 * 顶部的玩家条(稿 #2a 的 avatar strip)。
 * 窄屏会换行,不横向溢出。
 */
export function PlayerStrip() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {room.players.map((p) => (
        <span
          key={p.id}
          className={`inline-flex items-center gap-1.5 text-xs ${p.connected ? '' : 'opacity-55'}`}
        >
          <SeatDot seatNo={p.seatNo} size={7} />
          <span className={p.id === room.viewerId ? 'text-ink' : 'text-muted'}>{p.nickname}</span>
          <span className="font-mono text-[10px] text-muted/70">{seatBadge(p.seatNo)}</span>
          {p.id === room.oracleId && (
            <span className="text-[10px] text-ctrl">{t('ui', 'seat.oracle')}</span>
          )}
          {!p.connected && (
            <span className="text-[10px] text-judge-unclear">{t('ui', 'player.offline')}</span>
          )}
        </span>
      ))}
    </div>
  );
}
