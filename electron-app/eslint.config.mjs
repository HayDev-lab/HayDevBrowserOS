// @ts-check
/**
 * Flat ESLint config for electron-app.
 *
 * Why flat config (not .eslintrc):
 *   The parent Next.js project at /home/z/my-project ships `eslint.config.mjs`.
 *   ESLint's config-file walk discovers the parent's flat config when run from
 *   inside `electron-app/`, which forces flat-config mode and loads the
 *   parent's hoisted `@typescript-eslint/eslint-plugin@8.53.0` (eslint 9 only),
 *   crashing our local eslint 8.57.1.
 *
 *   Providing our own `eslint.config.mjs` in `electron-app/` short-circuits the
 *   walk so the parent's config is never reached.
 *
 * Why no @typescript-eslint plugin:
 *   See PROMPT 1 foundation report — environment hoisting conflict. TS-level
 *   defects are caught by `tsc --noEmit` (PASSES). Eslint here covers only
 *   core JS/structural rules. On a clean Windows host with `npm install`,
 *   `@typescript-eslint` should be re-enabled.
 */
import js from '@eslint/js';

export default [
  {
    ignores: ['dist/**', '.vite/**', 'out/**', 'node_modules/**', '*.config.ts'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: (await import('@typescript-eslint/parser')).default,
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'error',
      'no-debugger': 'error',
      'no-var': 'error',
      'no-duplicate-case': 'error',
      'no-irregular-whitespace': 'error',
      'no-redeclare': 'off',
      'no-console': 'off',
      'no-unused-vars': 'off',
      // @typescript-eslint recommends disabling `no-undef` for TS files
      // because the type system (tsc --noEmit, which PASSES) already covers
      // undefined references. The core rule produces false positives on
      // environment globals like `process`, `__dirname`, `window`, `document`,
      // and on ambient declarations (`MAIN_VITE_ENTRY`, `RENDERER_VITE_ENTRY`).
      'no-undef': 'off',
    },
  },
];
