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

import type {
  TabState,
  HistoryEntry,
  Bookmark,
  DownloadItemState,
  OpenTabRequest,
  NavigateRequest,
  TabIdRequest,
  HistoryQuery,
  HistoryAddRequest,
  BookmarkAddRequest,
} from './browser-types';

// Re-export all browser types for convenience.
export * from './browser-types';

// ---------------------------------------------------------------------------
// Foundation channels (PROMPT 1)
// ---------------------------------------------------------------------------
export type FoundationChannel =
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

// ---------------------------------------------------------------------------
// Browser Core channels (PROMPT 2)
// ---------------------------------------------------------------------------
export type BrowserChannel =
  // Tabs
  | 'browser:tabs:list'
  | 'browser:tabs:open'
  | 'browser:tabs:close'
  | 'browser:tabs:activate'
  // Navigation
  | 'browser:navigate'
  | 'browser:back'
  | 'browser:forward'
  | 'browser:reload'
  | 'browser:stop'
  // History
  | 'browser:history:query'
  | 'browser:history:delete'
  | 'browser:history:clear'
  | 'browser:history:add'
  // Bookmarks
  | 'browser:bookmarks:list'
  | 'browser:bookmarks:add'
  | 'browser:bookmarks:delete'
  // Downloads
  | 'browser:downloads:list'
  | 'browser:downloads:cancel'
  | 'browser:downloads:remove';

// ---------------------------------------------------------------------------
// Combined channel set
// ---------------------------------------------------------------------------
export type ChannelName = FoundationChannel | BrowserChannel;

// ---------------------------------------------------------------------------
// Renderer-facing typed API surface
// ---------------------------------------------------------------------------
export interface BrowserApi {
  // Tabs
  listTabs(): Promise<TabState[]>;
  openTab(request: OpenTabRequest): Promise<string>;
  closeTab(tabId: string): Promise<boolean>;
  activateTab(tabId: string): Promise<boolean>;

  // Navigation
  navigate(request: NavigateRequest): Promise<boolean>;
  back(tabId: string): Promise<boolean>;
  forward(tabId: string): Promise<boolean>;
  reload(tabId: string): Promise<boolean>;
  stop(tabId: string): Promise<boolean>;

  // History
  queryHistory(query: HistoryQuery): Promise<HistoryEntry[]>;
  deleteHistory(id: string): Promise<boolean>;
  clearHistory(): Promise<void>;
  addHistory(request: HistoryAddRequest): Promise<HistoryEntry>;

  // Bookmarks
  listBookmarks(): Promise<Bookmark[]>;
  addBookmark(request: BookmarkAddRequest): Promise<Bookmark>;
  deleteBookmark(id: string): Promise<boolean>;

  // Downloads
  listDownloads(): Promise<DownloadItemState[]>;
  cancelDownload(id: string): Promise<boolean>;
  removeDownload(id: string): Promise<boolean>;
}

/**
 * The renderer-side API surface exposed via contextBridge.
 * MUST stay serialisable (no functions carrying closures over Node objects).
 */
export interface ExposedApi {
  // Foundation
  getVersion(): Promise<AppVersionInfo>;
  ping(payload: FoundationPingPayload): Promise<FoundationPingResult>;

  // Browser Core
  browser: BrowserApi;

  // Event subscription (whitelisted channels only)
  on(channel: string, listener: (data: unknown) => void): () => void;
}

declare global {
  interface Window {
    api: ExposedApi;
  }
}

export const API_NAMESPACE = 'api' as const;
