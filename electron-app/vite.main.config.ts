import { defineConfig } from 'vite';

// Vite build configuration for the Electron MAIN process.
// Output is consumed by Electron Forge plugin-vite and emitted to .vite/build/main.js
export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: 'src/main/index.ts' },
      external: ['electron'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
    outDir: '.vite/build',
    emptyOutDir: false,
  },
  resolve: {
    // Allow main to import the shared IPC contract module without bundling it twice.
    alias: {
      '@shared': '/src/shared',
    },
  },
  // Disable PostCSS auto-discovery — main process has no CSS, but Vite still
  // walks up directories and hits the parent Next.js Tailwind v4 postcss config.
  css: {
    postcss: {
      plugins: [],
    },
  },
});
