/**
 * Ambient declarations for the @electron-forge/plugin-vite injected globals.
 *
 * @electron-forge/plugin-vite injects per-renderer globals named after the
 * renderer config `name` field (see forge.config.ts → VitePlugin.renderer).
 * Our renderer is named `main_window`, so the dev server URL is exposed as
 * `MAIN_WINDOW_VITE_DEV_SERVER_URL` and the renderer build name as
 * `MAIN_WINDOW_VITE_NAME`.
 *
 * These globals are ONLY defined in dev mode (when the Vite dev server is
 * running). In the packaged build, they are `undefined` and the main
 * process falls back to `loadFile` against the bundled renderer HTML.
 *
 * The legacy `MAIN_VITE_ENTRY` / `RENDERER_VITE_ENTRY` constants from the
 * electron-vite toolchain are NOT used by @electron-forge/plugin-vite and
 * are always undefined here. They are kept only for backward-compat with
 * any external tooling that still references them.
 */
declare const MAIN_VITE_ENTRY: string | undefined;
declare const RENDERER_VITE_ENTRY: string | undefined;
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string | undefined;

// Vite asset imports (renderer)
declare module '*.png' {
  const src: string;
  export default src;
}
