/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端地址。跨 repo URL 只能来自 env(CONVENTIONS.md)。 */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
