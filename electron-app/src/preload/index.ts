/**
 * PRELOAD script — Personal Agentic Browser (Foundation v0.1).
 *
 * SECURITY:
 *  Runs with `sandbox: true` (set in BrowserWindow webPreferences). Therefore
 *  this module has NO access to the full Node `require`. Only the limited
 *  `electron` surface exposed to sandboxed preload scripts is available:
 *  - `contextBridge`
 *  - `ipcRenderer` (invoke/on/off/removeListener)
 *
 *  The renderer NEVER receives raw ipcRenderer. It receives a strictly-typed
 *  `window.api` object whose shape is the contract in src/shared/ipc-types.ts.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type {
  ExposedApi,
  FoundationPingPayload,
  FoundationPingResult,
  AppVersionInfo,
} from '@shared/ipc-types';

// Whitelist of channels the renderer may invoke through the bridge.
// Anything NOT in this set is silently rejected at the preload boundary.
const ALLOWED_INVOKE_CHANNELS = new Set<string>([
  'app:version',
  'foundation:ping',
]);

// Forward-only channels the renderer may subscribe to.
const ALLOWED_LISTEN_CHANNELS = new Set<string>([
  // Reserved — no broadcasts in foundation stage.
]);

const api: ExposedApi = {
  async getVersion(): Promise<AppVersionInfo> {
    return ipcRenderer.invoke('app:version') as Promise<AppVersionInfo>;
  },

  async ping(
    payload: FoundationPingPayload
  ): Promise<FoundationPingResult> {
    return ipcRenderer.invoke(
      'foundation:ping',
      payload
    ) as Promise<FoundationPingResult>;
  },

  on(channel: string, listener: (data: unknown) => void): () => void {
    if (!ALLOWED_LISTEN_CHANNELS.has(channel)) {
      // Refuse subscription silently — do not throw to avoid leaking channel list.
      return () => {};
    }
    const wrapped = (_event: unknown, data: unknown): void => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

// `invoke` calls are also gated by the main process handler whitelist
// (only registered handlers exist), but we additionally guard the surface
// here so a compromised renderer cannot probe arbitrary channels.
const proxiedApi = new Proxy(api, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value === 'function') {
      return (...args: unknown[]) => {
        // Validate that any first-arg string channel is whitelisted (defensive).
        if (
          args.length > 0 &&
          typeof args[0] === 'string' &&
          prop === 'on'
        ) {
          if (!ALLOWED_LISTEN_CHANNELS.has(args[0] as string)) {
            return () => {};
          }
        }
        if (prop === 'getVersion' || prop === 'ping') {
          // These are direct methods; main-side handler whitelist enforces them.
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
    return value;
  },
});

contextBridge.exposeInMainWorld('api', proxiedApi);
