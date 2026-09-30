import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite build configuration for the TAB PRELOAD script (login form capture).
// Separate from the chrome preload because the forge vite plugin builds
// each preload target as a single-input, single-file bundle. Runs under
// `sandbox: true` — only the limited sandboxed `electron` surface is used.
export default defineConfig({
  build: {
    rollupOptions: {
      input: { tabPreload: 'src/preload/tab-preload.ts' },
      external: ['electron'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        format: 'cjs',
      },
    },
    outDir: '.vite/build',
    emptyOutDir: false,
    target: 'node18',
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
});
