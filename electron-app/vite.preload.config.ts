import { defineConfig } from 'vite';

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
      '@shared': '/src/shared',
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
