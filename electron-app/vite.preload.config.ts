import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite build configuration for the Electron PRELOAD script.
// Preload MUST run under `sandbox: true`, so it cannot use Node `require`.
// It must only use contextBridge + the limited `electron` surface exposed to sandboxes.
export default defineConfig({
  build: {
    rollupOptions: {
      input: { preload: 'src/preload/index.ts' },
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
  // Disable PostCSS auto-discovery — preload has no CSS, but Vite still
  // walks up directories and hits the parent Next.js Tailwind v4 postcss config.
  css: {
    postcss: {
      plugins: [],
    },
  },
});
