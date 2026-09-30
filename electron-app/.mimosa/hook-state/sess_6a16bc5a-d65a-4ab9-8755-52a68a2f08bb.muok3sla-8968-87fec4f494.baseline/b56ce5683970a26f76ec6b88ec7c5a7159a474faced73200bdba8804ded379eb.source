import type { ExposedApi } from '@shared/ipc-types';
import { electronApi } from './electron';
import { tauriApi } from './tauri';

export type DesktopRuntime = 'tauri' | 'electron';

/**
 * Runtime detection. Tauri injects `window.__TAURI_INTERNALS__` into every
 * webview it hosts BEFORE page scripts run, so the check is deterministic.
 * Anything else (Electron renderer, tests, plain web) falls back to the
 * Electron bridge proxy.
 */
export function detectRuntime(): DesktopRuntime {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    return 'tauri';
  }
  return 'electron';
}

export const runtime: DesktopRuntime = detectRuntime();

/**
 * Platform-agnostic API. Tauri adapter when running under Tauri 2,
 * the preload `window.api` bridge otherwise. App code must call THIS
 * (never `window.api` / `__TAURI__` / `ipcRenderer` directly) so the
 * desktop runtime stays swappable.
 */
export const platformApi: ExposedApi = runtime === 'tauri' ? tauriApi : electronApi;
