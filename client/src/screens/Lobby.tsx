/**
 * Lobby —— 房间码 + 在座玩家 + **oracle 座位区** + 设置 + ready。
 *
 * SPEC §9 推翻稿的三条在这里兑现:
 *   · 稿的「至少需 3 人」→ **co-op ≥ 2**(文案取自 NOT_ENOUGH_PLAYERS)。
 *   · 稿没有出题人字段 → **有 oracle 座位区**(§2)。
 *   · ADR-10 的 reroll 入口在这里,挂在自己名字上 —— 不是首屏关卡。
 *
 * **不做乐观更新**:所有按钮只 emit,界面等 `s:room_state` 回来才变。
 * 座位按钮尤其如此 —— 抢输了会收 SEAT_TAKEN,本地先画上去只会闪一下。
 */

import { PUZZLE_TYPE_IDS } from '@shared/puzzleTypes';
import { GAME_META } from '@shared/meta';
import { PlayerTag } from '@/components/player';
import { RoomHeader, ScreenShell } from '@/components/RoomHeader';
import { Button, Field, Kicker, Panel, TextInput } from '@/components/ui';
import { rerollNickname } from '@/lib/nickname';
import { useIsHost, useIsOracle, useMe, useRoomStore } from '@/store/roomStore';
import { useT } from '@/store/langStore';
import { useState } from 'react';

export default function Lobby() {
  const t = useT();
  const room = useRoomStore((s) => s.room)!;
  const isHost = useIsHost();
  const isOracle = useIsOracle();
  const me = useMe();
  const {
    setReady,
    setNickname,
    updateSettings,
    kickPlayer,
    transferHost,
    claimOracle,
    releaseOracle,
    assignOracle,
    startGame,
    leaveRoom,
  } = useRoomStore();
  const [copied, setCopied] = useState(false);

  const oracle = room.players.find((p) => p.id === room.oracleId) ?? null;
  const canStart =
    room.players.length >= GAME_META.minPlayers &&
    room.oracleId !== null &&
    room.players.every((p) => p.isReady);

  return (
    <ScreenShell wide>
      <RoomHeader compact />

      {/* ── 房间码:lobby 是唯一需要把码放大的地方(要念给朋友听)── */}
      <Panel className="flex flex-wrap items-center gap-3 p-5">
        <div>
          <Kicker>{t('ui', 'lobby.roomCode')}</Kicker>
          <div className="mt-1 font-mono text-3xl tracking-[0.2em] text-ink">{room.code}</div>
          <p className="mt-1 text-xs text-muted">{t('ui', 'lobby.shareHint')}</p>
        </div>
        <Button
          className="ml-auto"
          onClick={() => {
            void navigator.clipboard?.writeText(room.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? t('ui', 'lobby.copied') : t('ui', 'lobby.copy')}
        </Button>
        <Button variant="danger" onClick={leaveRoom}>
          {t('ui', 'lobby.leave')}
        </Button>
      </Panel>

      {/* ── oracle 座位区(SPEC §2:显式座位,可空)── */}
      <Panel className="p-5">
        <Kicker>{t('ui', 'seat.oracle')}</Kicker>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 text-sm">
            {oracle ? (
              <PlayerTag player={oracle} />
            ) : (
              <span className="text-judge-unclear">{t('ui', 'seat.empty')}</span>
            )}
          </div>

          {/* 在座 guesser 可直接上位;座位有人时按钮消失,不给「抢」的错觉 */}
          {!isOracle && room.oracleId === null && (
            <Button variant="solid" onClick={claimOracle}>
              {t('ui', 'seat.claim')}
            </Button>
          )}
          {isOracle && <Button onClick={releaseOracle}>{t('ui', 'seat.release')}</Button>}
        </div>

        {/* host 改派:可以覆盖已占座位 —— 这是权力,不是竞争 */}
        {isHost && room.players.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
            <span className="text-xs text-muted">host →</span>
            {room.players
              .filter((p) => p.id !== room.oracleId)
              .map((p) => (
                <Button key={p.id} className="px-2.5 py-1 text-xs" onClick={() => assignOracle(p.id)}>
                  <PlayerTag player={p} showBadge={false} />
                </Button>
              ))}
            {room.oracleId && <Button onClick={() => assignOracle(null)}>✕</Button>}
          </div>
        )}
      </Panel>

      {/* ── 在座玩家 ── */}
      <Panel className="p-5">
        <div className="flex items-baseline justify-between">
          <Kicker>{t('ui', 'lobby.players')}</Kicker>
          <span className="text-xs text-muted">
            {room.players.length} / {room.settings.maxPlayers}
          </span>
        </div>
        <ul className="mt-3 divide-y divide-line/60">
          {room.players.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5 text-sm">
              {/* 身份三件套统一走 PlayerTag:颜色点 · 名字 · 序号 · 「你」 */}
              <span className={p.connected ? '' : 'opacity-45 line-through'}>
                <PlayerTag player={p} />
              </span>
              {p.isHost && <span className="text-xs text-muted">· {t('ui', 'lobby.host')}</span>}
              {p.id === room.oracleId && (
                <span className="text-xs text-ctrl">· {t('ui', 'seat.oracle')}</span>
              )}

              <span className="ml-auto text-xs">
                {p.isReady ? (
                  <span className="text-judge-yes">✓ {t('ui', 'lobby.ready')}</span>
                ) : (
                  <span className="text-muted">{t('ui', 'lobby.unready')}</span>
                )}
              </span>

              {/* ADR-10:改名入口在这里,挂在自己名字上 */}
              {p.id === room.viewerId && (
                <Button className="px-2 py-1 text-xs" onClick={() => setNickname(rerollNickname())}>
                  {t('ui', 'player.reroll')}
                </Button>
              )}
              {isHost && p.id !== room.viewerId && (
                <>
                  {/* 用文字而不是 ♔ —— 王冠字形在中文字体里会掉成豆腐块 */}
                  <Button className="px-2 py-1 text-xs" onClick={() => transferHost(p.id)}>
                    {t('ui', 'lobby.makeHost')}
                  </Button>
                  <Button
                    variant="danger"
                    className="px-2 py-1 text-xs"
                    onClick={() => kickPlayer(p.id)}
                  >
                    {t('ui', 'lobby.kick')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      {/* ── 设置:host-only,仅 lobby phase(server 也拦,这里只是不给按)── */}
      <Panel className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Kicker>{t('ui', 'lobby.settings')}</Kicker>
        </div>

        <Field label={t('ui', 'lobby.puzzleType')}>
          <div className="flex gap-2">
            {PUZZLE_TYPE_IDS.map((id) => (
              <Button
                key={id}
                variant={room.settings.puzzleType === id ? 'solid' : 'ghost'}
                disabled={!isHost}
                onClick={() => updateSettings({ puzzleType: id })}
              >
                {t('puzzleType', id)}
              </Button>
            ))}
          </div>
        </Field>

        {/* 额度只在 budget 非 null 时出现 —— 由 config 表决定,不判类型 */}
        {room.settings.budget !== null && (
          <Field label={t('ui', 'lobby.budget')}>
            <TextInput
              type="number"
              min={1}
              max={99}
              disabled={!isHost}
              value={room.settings.budget}
              onChange={(e) => updateSettings({ budget: Number(e.target.value) })}
            />
          </Field>
        )}

        <Field label={t('ui', 'lobby.pendingCap')}>
          <TextInput
            type="number"
            min={GAME_META.pendingCapMin}
            max={GAME_META.pendingCapMax}
            disabled={!isHost}
            value={room.settings.pendingCap}
            onChange={(e) => updateSettings({ pendingCap: Number(e.target.value) })}
          />
        </Field>

        <Field label={t('ui', 'lobby.maxPlayers')}>
          <TextInput
            type="number"
            min={GAME_META.minPlayers}
            max={GAME_META.maxPlayersLimit}
            disabled={!isHost}
            value={room.settings.maxPlayers}
            onChange={(e) => updateSettings({ maxPlayers: Number(e.target.value) })}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-ctrl sm:col-span-2">
          <input
            type="checkbox"
            disabled={!isHost}
            checked={room.settings.isPrivate}
            onChange={(e) => updateSettings({ isPrivate: e.target.checked })}
          />
          {t('ui', 'lobby.private')}
        </label>
      </Panel>

      {/* ── ready / start ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          variant={me?.isReady ? 'ghost' : 'solid'}
          onClick={() => setReady(!me?.isReady)}
          className="flex-1"
        >
          {me?.isReady ? t('ui', 'lobby.unready') : t('ui', 'lobby.ready')}
        </Button>
        {isHost && (
          <Button variant="solid" disabled={!canStart} onClick={startGame} className="flex-1">
            {t('ui', 'game.start')}
          </Button>
        )}
      </div>
      {isHost && !canStart && (
        <p className="text-center text-xs text-muted">
          {room.players.length < GAME_META.minPlayers
            ? t('error', 'NOT_ENOUGH_PLAYERS')
            : room.oracleId === null
              ? t('error', 'NO_ORACLE_SEATED')
              : t('error', 'NOT_ALL_READY')}
        </p>
      )}
    </ScreenShell>
  );
}
