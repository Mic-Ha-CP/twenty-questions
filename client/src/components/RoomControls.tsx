/**
 * 房间级的常驻控件(smoke 第三轮带回)。
 *
 * 三件事,都必须**每一屏都有**,所以住在 RoomHeader 里而不是各屏各写一遍:
 *   · 离开房间(带确认,后果写清楚);
 *   · 房主离线横幅 / 房主已移交提示;
 *   · 语言切换(从右下角浮标移进顶栏)。
 */

import { useEffect, useState } from 'react';
import { Button, Modal, Panel } from '@/components/ui';
import { PlayerTagById } from '@/components/player';
import { shouldShowTransferControl } from '@/lib/seats';
import { fill } from '@/lib/strings';
import { useIsHost, useIsOracle, useRoomStore } from '@/store/roomStore';
import { useLangStore, useT } from '@/store/langStore';

/* ═══════════════════════ 语言切换 ═══════════════════════ */

export function LangToggle({ className = '' }: { className?: string }) {
  const t = useT();
  const { lang, setLang } = useLangStore();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      className={`rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:border-ctrl hover:text-ink ${className}`}
    >
      {/* 语言名是各自的自称,两本字典里一样 —— 但仍然走字典,不在组件里写死 */}
      {lang === 'zh' ? t('ui', 'lang.toEn') : t('ui', 'lang.toZh')}
    </button>
  );
}

/* ═══════════════════════ 离开房间 ═══════════════════════ */

/**
 * 离开房间。**带确认**,而且确认文案随处境变 ——
 * 出题人中途离开会触发接管路径(座位空出、host 指派新人),
 * 这件事必须在点下去之前就说清楚,不能事后才发现局散了。
 */
export function LeaveRoomButton() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const isOracle = useIsOracle();
  const { leaveRoom } = useRoomStore();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        variant="danger"
        className="px-2 py-0.5 text-[11px]"
        onClick={() => setConfirming(true)}
      >
        {t('ui', 'room.leave')}
      </Button>
    );
  }

  const midRound = room.phase !== 'lobby';
  return (
    <Modal>
      <Panel className="w-full max-w-sm border-judge-no/50 p-5">
        <p className="text-sm text-ink">{t('ui', 'room.leaveConfirm')}</p>
        {/* 后果分两层说:出题人的后果比普通猜题人重得多 */}
        {isOracle && (
          <p className="mt-2 text-xs text-muted">{t('ui', 'room.leaveConfirmOracle')}</p>
        )}
        {midRound && !isOracle && (
          <p className="mt-2 text-xs text-muted">{t('ui', 'room.leaveConfirmPlaying')}</p>
        )}
        <div className="mt-4 flex justify-end gap-3">
          <Button onClick={() => setConfirming(false)}>{t('ui', 'play.cancel')}</Button>
          <Button variant="danger" onClick={leaveRoom}>
            {t('ui', 'room.leaveYes')}
          </Button>
        </div>
      </Panel>
    </Modal>
  );
}

/* ═══════════════════════ 房主状态 ═══════════════════════ */

/**
 * 房主离线横幅。**全房可见** —— 大家都该知道「现在没人能开下一局,
 * 但再等等可能就好了」,而不是对着一个点不动的按钮猜。
 */
export function HostOfflineBanner() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const host = room.players.find((p) => p.id === room.hostId);
  if (!host || host.connected) return null;

  return (
    <div className="rounded border border-judge-unclear/45 bg-panel px-3 py-1.5 text-xs text-ink">
      {t('ui', 'host.offline')}
    </div>
  );
}

/** 房主已移交 —— 三条路(显式转让 / 离开 / 宽限到期)都会走到这里。 */
export function HostTransferNotice() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const transfer = useRoomStore((s) => s.hostTransfer);
  const clear = useRoomStore((s) => s.clearHostTransfer);

  useEffect(() => {
    if (!transfer) return;
    const id = setTimeout(clear, 8000);
    return () => clearTimeout(id);
  }, [transfer, clear]);

  if (!transfer) return null;
  const to = room.players.find((p) => p.id === transfer.to);
  return (
    <div className="rounded border border-judge-unclear/45 bg-panel px-3 py-1.5 text-xs text-ink">
      {fill(t('ui', 'host.transferred'), { name: to?.nickname ?? '—' })}
    </div>
  );
}

/* ═══════════════════════ 转移出题人 ═══════════════════════ */

/**
 * host 的中段接管入口(SPEC §7),**两段式确认**。
 *
 * 人数不够时整块隐藏 —— 判定依据是 server 投影里的 `canTransferOracle`,
 * **和 server 的守卫同源**(2 人房换完就没有没看过汤底的猜题人了)。
 */
export function TransferOracleControl() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const isHost = useIsHost();
  const { assignOracle } = useRoomStore();
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState<string | null>(null);

  // 2 人房中段:入口整个不出现,只剩「公开汤底 · 结束本局」那条路
  if (!shouldShowTransferControl({ isHost, canTransferOracle: room.canTransferOracle })) {
    return null;
  }

  const candidates = room.players.filter((p) => p.id !== room.oracleId);

  // 第二段:说清后果再确认
  if (target) {
    const name = room.players.find((p) => p.id === target)?.nickname ?? '—';
    return (
      <Modal>
        <Panel className="w-full max-w-md p-5">
          <p className="text-sm leading-relaxed text-ink">
            {fill(t('ui', 'oracle.transferConfirm'), { name })}
          </p>
          <div className="mt-4 flex justify-end gap-3">
            {/* 「再想想」一直留着 —— 这是个不可撤销的动作 */}
            <Button onClick={() => setTarget(null)}>{t('ui', 'play.cancel')}</Button>
            <Button
              variant="solid"
              onClick={() => {
                assignOracle(target);
                setTarget(null);
                setPicking(false);
              }}
            >
              {t('ui', 'oracle.transferConfirmYes')}
            </Button>
          </div>
        </Panel>
      </Modal>
    );
  }

  // 第一段:选人
  if (!picking) {
    return (
      <Button className="px-2.5 py-1 text-xs" onClick={() => setPicking(true)}>
        {t('ui', 'oracle.transferTo')}
      </Button>
    );
  }
  return (
    <Panel className="w-full p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{t('ui', 'oracle.transferTo')}</span>
        {candidates.map((p) => (
          <Button key={p.id} className="px-2.5 py-1 text-xs" onClick={() => setTarget(p.id)}>
            <PlayerTagById id={p.id} />
          </Button>
        ))}
        <Button className="ml-auto px-2.5 py-1 text-xs" onClick={() => setPicking(false)}>
          {t('ui', 'play.cancel')}
        </Button>
      </div>
    </Panel>
  );
}
