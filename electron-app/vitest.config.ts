import { defineConfig } from 'vitest/config';

// Vitest config — covers PURE LOGIC only.
//
// Scope:
//   - URL utilities, navigation stack, tab state machine, history store,
//     bookmarks store, download state machine.
//
// Out of scope (DEFERRED_RUNTIME):
//   - Anything that imports `electron` (BrowserWindow, WebContentsView,
//     session, app). Those modules live in `src/main/browser/runtime/`
//     and are NOT imported by tests.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
    pool: 'forks',
    isolate: true,
    coverage: { enabled: false },
  },
  resolve: {
    alias: {
      '@shared': '/src/shared',
      // '@' → the Perplexica checkout: production-path tests import the REAL
      // openaiLLM/researcher sources (bare deps resolve from Perplexica's
      // own node_modules). Tests skipIf the checkout is absent.
      '@': process.env.PAB_PERPLEXICA_SRC ?? 'D:/Projects/Perplexica/src',
    },
  },
});
