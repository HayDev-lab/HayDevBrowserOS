import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite build configuration for the Electron RENDERER process.
// Renderer is loaded with nodeIntegration:false, contextIsolation:true, sandbox:true.
// Therefore the renderer must NOT import Node built-ins directly; all native access
// goes through the typed preload bridge.
export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  build: {
    outDir: '../../.vite/build/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  // Disable PostCSS auto-discovery — the parent Next.js project at
  // /home/z/my-project ships a Tailwind v4 postcss.config.mjs that walks
  // into our build via Vite's directory-walk config discovery.
  // PROMPT 3 (Neural Cockpit) will introduce its own Tailwind setup scoped
  // to electron-app only.
  css: {
    postcss: {
      plugins: [],
    },
  },
  // Renderer target is Chromium shipping with Electron, no legacy polyfills needed.
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV ?? 'production'
    ),
  },
  // Dev server: fixed port, MUST match tauri.conf.json devUrl (single source
  // of truth — keep both in sync). strictPort fails LOUDLY on conflict
  // instead of silently hopping to another port that Tauri never loads.
  server: {
    port: 5180,
    strictPort: true,
  },
});
