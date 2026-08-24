/**
 * 最小组件集 —— 1c 悬疑侦探皮的具体化。
 *
 * 视觉规则(SPEC §9 四修正)在这里被兑现:
 *  · **琥珀只给三焦点**:汤面区 / 命中态 / 额度计数。所以 `Button` 的琥珀实心版
 *    叫 `focus`,**只允许**在那三处用;普通操作一律 `ghost`。
 *  · serif **只**给叙事文本 → `Narrative`。别的地方不许 `font-serif`。
 */

import type { ButtonHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

/**
 * 模态框。**必须走 portal 挂到 body 上。**
 *
 * 踩过一次:确认框直接写在 `RoomHeader` 里,而 header 有 `backdrop-blur` ——
 * `backdrop-filter` 会给 fixed 定位的后代造一个新的**包含块**,于是
 * `fixed inset-0` 不再相对视口,弹窗被压在顶栏那一小条里、上半截还被裁掉。
 * 挂到 body 就没有这个问题,顺便也不受任何祖先 overflow / transform 影响。
 */
export function Modal({ children }: { children: ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 px-4">
      {children}
    </div>,
    document.body,
  );
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded border border-line bg-panel shadow-panel ${className}`}>{children}</div>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">{children}</div>
  );
}

/**
 * 叙事文本 —— **serif 的唯一合法用途**(SPEC §9 修正 4)。
 * 汤面、标语走这里,按钮和标签不许用。
 */
export function Narrative({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={`font-serif leading-relaxed text-ink ${className}`}>{children}</p>;
}

type Variant = 'focus' | 'solid' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  /** 琥珀实心 —— **仅限三焦点**。别拿它当「主按钮」到处按。 */
  focus: 'bg-accent text-accent-ink hover:brightness-110 border-transparent',
  solid: 'bg-panel2 text-ink border-line hover:border-ctrl',
  ghost: 'bg-transparent text-ctrl border-line hover:border-ctrl hover:text-ink',
  danger: 'bg-transparent text-judge-no border-line hover:border-judge-no',
};

export function Button({
  variant = 'ghost',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`whitespace-nowrap rounded border px-3.5 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs text-muted">{label}</span>
        {hint ? <span className="text-[11px] text-muted/70">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

const INPUT_BASE =
  'w-full rounded border border-line bg-soft px-3 py-2 text-sm text-ink placeholder:text-muted/60 outline-none focus:border-ctrl';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input className={`${INPUT_BASE} ${className}`} {...rest} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <textarea className={`${INPUT_BASE} resize-y leading-relaxed ${className}`} {...rest} />;
}

/** 难度点。图标 + 数量双编码,不靠颜色。 */
export function Difficulty({ level }: { level?: 1 | 2 | 3 }) {
  if (!level) return null;
  return (
    <span className="font-mono text-[11px] text-muted" title={`${level}/3`}>
      {'●'.repeat(level)}
      {'○'.repeat(3 - level)}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
      {children}
    </span>
  );
}
