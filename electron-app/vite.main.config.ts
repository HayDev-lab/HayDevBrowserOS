import { defineConfig } from 'vite';

// Vite build configuration for the Electron MAIN process.
// Output is consumed by Electron Forge plugin-vite and emitted to .vite/build/main.js
export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: 'src/main/index.ts' },
      // `electron` and all Node built-ins must be external in the main bundle:
      //   - `electron` is provided by the Electron runtime.
      //   - `node:*` modules are provided by Node.js (Electron's main process
      //     runs on Node). Vite's default browser-platform externalizer would
      //     stub them with an empty object, breaking named imports such as
      //     `import { promises as fs } from 'node:fs'`.
      external: [
        'electron',
        'node:fs',
        'node:path',
        'node:os',
        'node:crypto',
        'node:url',
        'node:util',
        /^node:/,
      ],
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
