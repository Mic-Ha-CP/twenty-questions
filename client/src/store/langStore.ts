/**
 * 语言 store。**默认 zh —— zh 是被测路径**(SPEC §8)。
 * 不引 i18n 框架:一个 Zustand store + strings.ts 的双列字典就是全部。
 */

import { create } from 'zustand';
import { translate, type Lang } from '@/lib/strings';

const KEY = 'tq.lang';

function initialLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useLangStore = create<LangState>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* noop */
    }
    set({ lang });
  },
}));

/**
 * 组件里取翻译器。用法:
 *   const t = useT();
 *   t('ui', 'lobby.create');
 *   t('error', code);
 */
export function useT() {
  const lang = useLangStore((s) => s.lang);
  return <K extends Parameters<typeof translate>[1]>(
    group: K,
    key: Parameters<typeof translate<K>>[2],
  ) => translate(lang, group, key);
}
