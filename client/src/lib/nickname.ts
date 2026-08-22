/**
 * ⚠️ ─────────────────────────────────────────────────────────────────────────
 *  临时件 · ADR-10 · **删,不是重构。**
 *
 *  这个文件 + `shared/names.ts` 是平台身份落地前的**临时托管**。
 *  平台身份一到:identity 随 player 一起到达,首屏塌缩成纯 lobby,
 *  **这两个文件整块删掉**,别的地方不用改 —— 出口是一次删除,不是一次解耦。
 *
 *  SPEC §9(b)(勘误后):
 *    · **首屏没有 nickname 输入框。** Landing 直接就是「建房 / 加入」。
 *    · 显示名**静默生成**,存 localStorage。
 *    · reroll 入口在 **lobby 内**,挂在自己名字上 —— 改名是房内的次要动作,
 *      不是进门的关卡。
 *
 *  纪律:
 *    · 本模块**不进 Zustand store**、不进组件树的任何 context。
 *      要用就在调用点 `import { getIdentity }` 拿,用完丢。
 *    · playerId 是**唯一**的身份;nickname 纯展示,重名 server 端重摇。
 *      任何模块想用名字做判断 = bug。
 * ───────────────────────────────────────────────────────────────────────── ⚠️
 */

import { generateGuestName } from '@shared/names';

const KEY_PLAYER_ID = 'tq.playerId';
const KEY_NICKNAME = 'tq.nickname';

export interface Identity {
  /** 稳定 UUID。断线重连、oracle 接管全靠它 —— **永不因改名而变**。 */
  playerId: string;
  /** 纯展示。 */
  nickname: string;
}

function readOrCreate(key: string, make: () => string): string {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = make();
    localStorage.setItem(key, created);
    return created;
  } catch {
    // 隐私模式 / 禁用 storage:退化成本次会话内有效的临时身份,不崩。
    return make();
  }
}

/** 静默取身份;没有就当场生成。**不弹任何 UI。** */
export function getIdentity(): Identity {
  return {
    playerId: readOrCreate(KEY_PLAYER_ID, () => crypto.randomUUID()),
    nickname: readOrCreate(KEY_NICKNAME, generateGuestName),
  };
}

/** lobby 内的 reroll 入口用。只换名字,**playerId 不动**。 */
export function rerollNickname(): string {
  const next = generateGuestName();
  try {
    localStorage.setItem(KEY_NICKNAME, next);
  } catch {
    /* 存不下就算了,本次会话仍然可用 */
  }
  return next;
}

/** server 重摇过名字之后,把结果写回本地,免得下次进房又用旧名。 */
export function rememberNickname(nickname: string): void {
  try {
    localStorage.setItem(KEY_NICKNAME, nickname);
  } catch {
    /* noop */
  }
}
