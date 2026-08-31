/**
 * Shared IPC contract between Main process, Preload boundary, and Renderer.
 *
 * SECURITY NOTE:
 *  This module is the ONLY typed surface across the security boundary.
 *  - Main process may freely use Node/Electron APIs.
 *  - Preload may ONLY use contextBridge + ipcRenderer.invoke/on.
 *  - Renderer may ONLY use the exposed `window.api` object.
 *
 *  No credentials, secrets, file paths, or Node objects may travel through this channel.
 */

export type ChannelName =
  | 'app:version'
  | 'app:platform'
  | 'foundation:ping';

export interface FoundationPingPayload {
  timestamp: number;
  message: string;
}

export interface FoundationPingResult {
  receivedAt: number;
  echoed: FoundationPingPayload;
}

export interface AppVersionInfo {
  electron: string;
  chrome: string;
  node: string;
  appVersion: string;
}

/**
 * The renderer-side API surface exposed via contextBridge.
 * MUST stay serialisable (no functions carrying closures over Node objects).
 */
export interface ExposedApi {
  getVersion(): Promise<AppVersionInfo>;
  ping(payload: FoundationPingPayload): Promise<FoundationPingResult>;
  on(channel: string, listener: (data: unknown) => void): () => void;
}

declare global {
  interface Window {
    api: ExposedApi;
  }
}

export const API_NAMESPACE = 'api' as const;
