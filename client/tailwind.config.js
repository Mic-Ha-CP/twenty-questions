/**
 * 1c「悬疑侦探 dark」主题 token。
 *
 * 取自 docs/design/ui-reference.html 的 **`#2a`「悬疑侦探方向 · 全流程 5 屏」** 一节
 * (SPEC §9 勘误 2 划定的唯一权威范围;1a/1b/未修正 1c 不作参照)。
 * 值是从该节 `<section id="2a">` 的 CSS 自定义属性上原样抄下来的。
 *
 * 四条修正(SPEC §9)在 token 层的体现:
 *   1. 琥珀 accent **限三焦点** —— 汤面区 / 命中态 / 额度计数。别处不许用 `accent`。
 *   2. 判定色分离,「无关」压灰 —— judge.* 各自成色,irrelevant 走 neutral。
 *   3. 图标双编码 —— 颜色**永远**配图标(✓ ✗ — ◐ ? ★),不靠颜色单独承载语义。
 *   4. serif **仅**用于叙事文本(汤面)—— 所以 serif 是 `font-serif`,不是 body 字体。
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── 底层 ──
        bg: '#0f1014',
        soft: '#121319',
        panel: '#181a22',
        panel2: '#1e2029',
        line: '#2b2d38',

        // ── 文字 ──
        ink: '#e9e3d6',
        muted: '#89836f',
        ctrl: '#c6c1b2',

        // ── 琥珀:三焦点专用,别处不许碰 ──
        accent: 'oklch(0.80 0.13 74)',
        'accent-ink': '#14140e',

        /**
         * ── 判定色(SPEC §8 的六个语义)──
         * key 与 shared/puzzleTypes.ts 的 Answer enum 一一对应,
         * 这样按钮组可以照 config 表的 `answers` 数组渲染,不需要 if(type)。
         */
        judge: {
          yes: 'oklch(0.80 0.15 150)', // ✓ 是
          no: 'oklch(0.68 0.20 25)', // ✗ 不是
          irrelevant: '#6f6a5c', // — 无关(压灰,修正 2)
          unclear: 'oklch(0.72 0.06 245)', // ? 不确定(20Q)
          /**
           * ⚠️ ◐ 是也不是。设计稿把它画成 accent(= 琥珀),
           * 但 SPEC §9 修正 1 规定琥珀**只留给三焦点**,是也不是不在其中。
           * 两者冲突,**未裁定** —— 见 NOTES 偏差 log。
           * 这里先按稿的值落着;建判定按钮组之前必须解掉。
           */
          both: 'oklch(0.80 0.13 74)',
          /** ★ 就是它!命中态 —— 这个**是**三焦点之一,用琥珀名正言顺。 */
          correct: 'oklch(0.80 0.13 74)',
        },
      },
      fontFamily: {
        sans: ['Noto Sans SC', 'system-ui', 'sans-serif'],
        /** 修正 4:serif 仅用于叙事文本(汤面),不是 body 字体。 */
        serif: ['Playfair Display', 'Noto Serif SC', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
      boxShadow: {
        panel: '0 26px 60px rgba(0, 0, 0, .5)',
      },
      backgroundImage: {
        /** Landing 的顶光。稿里的 radial-gradient。 */
        vault: 'radial-gradient(90% 70% at 50% 0%, #1a1c26 0%, #0f1014 60%)',
      },
    },
  },
  plugins: [],
};
