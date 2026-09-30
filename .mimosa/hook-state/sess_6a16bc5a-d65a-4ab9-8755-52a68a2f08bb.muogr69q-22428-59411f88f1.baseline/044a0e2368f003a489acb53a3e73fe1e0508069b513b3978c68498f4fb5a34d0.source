import type { ExposedApi } from '@shared/ipc-types';

/**
 * Electron adapter — resolves to the preload contextBridge surface
 * (`window.api`). Property access is lazy so import order never matters:
 * in Electron the preload runs before this renderer bundle evaluates.
 *
 * The bridge object is the single Electron surface the renderer may touch;
 * raw `ipcRenderer` never crosses this boundary (enforced by the preload).
 */
export const electronApi: ExposedApi = new Proxy({} as ExposedApi, {
  get(_target, prop) {
    if (typeof window === 'undefined') return undefined;
    const bridge = window as unknown as { api?: Record<string | symbol, unknown> };
    const api = bridge.api;
    if (!api) return undefined;
    const value = api[prop];
    if (value === undefined) return undefined;
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(api) : value;
  },
});
