// CONVENTIONS.md 要的是「typecheck + lint」。typecheck 由 tsc 管,这里只管 lint。
// 刻意保持薄:这个 tier 不需要一套风格警察,只需要挡住真会咬人的几类写法。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // 前缀 _ 的形参是「故意不用」的信号,别报。
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // 这个 repo 里 any 基本都是外部 payload,应该走 unknown + 收窄。
      '@typescript-eslint/no-explicit-any': 'error',
      // 漏 await 是本 repo 最危险的一类 bug:Room 的 mutation 全是同步的,
      // 一旦有人在里面引入 await,oracle 座位的「先到先得」就不再成立。
      'no-floating-decimal': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },
);
