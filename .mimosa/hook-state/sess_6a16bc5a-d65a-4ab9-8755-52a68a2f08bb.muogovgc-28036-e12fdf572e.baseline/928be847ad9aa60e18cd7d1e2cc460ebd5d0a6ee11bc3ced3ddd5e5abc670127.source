import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { existsSync } from 'node:fs';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Personal Agentic Browser',
    executableName: 'PersonalAgenticBrowser',
    asar: true,
    // Internal runtimes (tor / searxng / perplexica) are read-only bundled
    // resources — copied out of asar so executables can run (spec §77/§78).
    // Produced by `node scripts/bundle-runtimes.mjs` BEFORE packaging;
    // omitted from the package when the bundle was not built.
    ...(existsSync('./resources/runtimes') ? { extraResource: ['./resources/runtimes'] } : {}),
    icon: 'icon.ico',
    // Windows target — production v1 is Windows-only.
    // `--platform=win32` will be enforced at package/make time on a Windows host
    // (or via wine on Linux; out of scope for this sandbox).
  },
  rebuildConfig: {},
  makers: [
    // Squirrel is the canonical Windows installer producer.
    new MakerSquirrel({
      name: 'personal_agentic_browser',
      setupIcon: 'icon.ico',
    }),
    // ZIP maker as a portable fallback (cross-platform build verification).
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          config: 'vite.main.config.ts',
          entry: 'src/main/index.ts',
          target: 'main',
        },
        {
          config: 'vite.preload.config.ts',
          entry: 'src/preload/index.ts',
          target: 'preload',
        },
        {
          config: 'vite.tab-preload.config.ts',
          entry: 'src/preload/tab-preload.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
