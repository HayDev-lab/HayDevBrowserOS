/**
 * Ambient declarations for the @electron-forge/plugin-vite injected globals.
 *
 * `MAIN_VITE_ENTRY` and `RENDERER_VITE_ENTRY` are injected at dev/build time
 * by the Vite plugin when bundling the main process.
 */
declare const MAIN_VITE_ENTRY: string | undefined;
declare const RENDERER_VITE_ENTRY: string | undefined;
