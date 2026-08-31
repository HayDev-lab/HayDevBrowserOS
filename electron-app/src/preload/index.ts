/**
 * PRELOAD script — Personal Agentic Browser (Foundation + Browser Core).
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
  BrowserApi,
  AppVersionInfo,
  FoundationPingPayload,
  FoundationPingResult,
  OpenTabRequest,
  NavigateRequest,
  TabIdRequest,
  HistoryQuery,
  HistoryAddRequest,
  BookmarkAddRequest,
  TabState,
  HistoryEntry,
  Bookmark,
  DownloadItemState,
} from '@shared/ipc-types';

// Whitelist of channels the renderer may invoke through the bridge.
// Anything NOT in this set is silently rejected at the preload boundary.
const ALLOWED_INVOKE_CHANNELS = new Set<string>([
  // Foundation
  'app:version',
  'foundation:ping',
  // Browser Core — tabs
  'browser:tabs:list',
  'browser:tabs:open',
  'browser:tabs:close',
  'browser:tabs:activate',
  // Browser Core — navigation
  'browser:navigate',
  'browser:back',
  'browser:forward',
  'browser:reload',
  'browser:stop',
  // Browser Core — history
  'browser:history:query',
  'browser:history:delete',
  'browser:history:clear',
  'browser:history:add',
  // Browser Core — bookmarks
  'browser:bookmarks:list',
  'browser:bookmarks:add',
  'browser:bookmarks:delete',
  // Browser Core — downloads
  'browser:downloads:list',
  'browser:downloads:cancel',
  'browser:downloads:remove',
]);

// Forward-only channels the renderer may subscribe to.
const ALLOWED_LISTEN_CHANNELS = new Set<string>([
  // Reserved — push-based updates come in PROMPT 3+ when UI needs live refresh.
]);

// Type-safe invoke helper. The cast through `unknown` is necessary because
// ipcRenderer.invoke returns `Promise<unknown>`; we assert the channel
// contract on the TypeScript side instead.
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
    return Promise.reject(
      new Error(`preload: channel not allowed: ${channel}`)
    );
  }
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const browserApi: BrowserApi = {
  // Tabs
  listTabs: () => invoke<TabState[]>('browser:tabs:list'),
  openTab: (request: OpenTabRequest) => invoke<string>('browser:tabs:open', request),
  closeTab: (tabId: string) => {
    const req: TabIdRequest = { tabId };
    return invoke<boolean>('browser:tabs:close', req);
  },
  activateTab: (tabId: string) => {
    const req: TabIdRequest = { tabId };
    return invoke<boolean>('browser:tabs:activate', req);
  },

  // Navigation
  navigate: (request: NavigateRequest) => invoke<boolean>('browser:navigate', request),
  back: (tabId: string) => {
    const req: TabIdRequest = { tabId };
    return invoke<boolean>('browser:back', req);
  },
  forward: (tabId: string) => {
    const req: TabIdRequest = { tabId };
    return invoke<boolean>('browser:forward', req);
  },
  reload: (tabId: string) => {
    const req: TabIdRequest = { tabId };
    return invoke<boolean>('browser:reload', req);
  },
  stop: (tabId: string) => {
    const req: TabIdRequest = { tabId };
    return invoke<boolean>('browser:stop', req);
  },

  // History
  queryHistory: (query: HistoryQuery) => invoke<HistoryEntry[]>('browser:history:query', query),
  deleteHistory: (id: string) => invoke<boolean>('browser:history:delete', { id }),
  clearHistory: () => invoke<void>('browser:history:clear'),
  addHistory: (request: HistoryAddRequest) => invoke<HistoryEntry>('browser:history:add', request),

  // Bookmarks
  listBookmarks: () => invoke<Bookmark[]>('browser:bookmarks:list'),
  addBookmark: (request: BookmarkAddRequest) => invoke<Bookmark>('browser:bookmarks:add', request),
  deleteBookmark: (id: string) => invoke<boolean>('browser:bookmarks:delete', { id }),

  // Downloads
  listDownloads: () => invoke<DownloadItemState[]>('browser:downloads:list'),
  cancelDownload: (id: string) => invoke<boolean>('browser:downloads:cancel', { id }),
  removeDownload: (id: string) => invoke<boolean>('browser:downloads:remove', { id }),
};

const api: ExposedApi = {
  async getVersion(): Promise<AppVersionInfo> {
    return invoke<AppVersionInfo>('app:version');
  },

  async ping(
    payload: FoundationPingPayload
  ): Promise<FoundationPingResult> {
    return invoke<FoundationPingResult>('foundation:ping', payload);
  },

  browser: browserApi,

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

contextBridge.exposeInMainWorld('api', api);
