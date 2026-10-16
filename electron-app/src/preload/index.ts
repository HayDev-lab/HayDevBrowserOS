/**
 * PRELOAD script — HayDev Browser OS (Foundation + Browser Core).
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
  AgentApi,
  ControlApi,
  VaultApi,
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
  AgentRunRequest,
  AgentRunResult,
  AgentStatusSnapshot,
  AgentTimelineEntry,
  ControlMode,
  VaultSaveInput,
  VaultGenerateInput,
  VaultFillInput,
  VaultHasInput,
  VaultSaveResult,
  VaultGenerateResult,
  VaultFillResult,
  VaultHasResult,
  VaultListResult,
  VaultDeleteResult,
  PasswordSavePrompt,
  WindowApi,
  RuntimeStatus,
} from '@shared/ipc-types';
import type { MemorySavePrompt } from '@shared/memory-types';

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
  // Agent Runtime (PROMPT 5)
  'agent:run',
  'agent:stop',
  'agent:status',
  'agent:timeline:list',
  'agent:research:report',
  // Control mode (PROMPT 5)
  'control:setMode',
  'control:takeControl',
  'control:getMode',
  // Vault (PROMPT 6)
  'vault:save',
  'vault:has',
  'vault:list',
  'vault:generateAndStore',
  'vault:fill',
  'vault:delete',
  'vault:prompt:current',
  'vault:prompt:resolve',
  'memory:prompt:current',
  'memory:prompt:resolve',
]);

// Forward-only channels the renderer may subscribe to (push events from main).
const ALLOWED_LISTEN_CHANNELS = new Set<string>([
  'agent:state:update',
  'agent:timeline:update',
  'control:mode:update',
  'vault:prompt:update',
  'memory:prompt:update',
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

// ---------------------------------------------------------------------------
// Agent Runtime API (PROMPT 5)
// ---------------------------------------------------------------------------
const agentApi: AgentApi = {
  run: (request: AgentRunRequest) =>
    invoke<AgentRunResult>('agent:run', request),
  stop: (reason?: string) =>
    invoke<{ accepted: boolean }>('agent:stop', reason),
  status: () => invoke<AgentStatusSnapshot>('agent:status'),
  listTimeline: () => invoke<AgentTimelineEntry[]>('agent:timeline:list'),
  researchReport: () =>
    invoke<import('@shared/research-types').ResearchReport | null>('agent:research:report'),
  pickAttachment: (kind?: 'file' | 'image') =>
    invoke<{ attachment: import('@shared/newtab-bridge').NewTabAttachment | null }>(
      'agent:pickAttachment',
      kind
    ),
};

// ---------------------------------------------------------------------------
// Window API — frameless Matrix title bar controls (fire-and-forget sends).
// ---------------------------------------------------------------------------
const windowApi: WindowApi = {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  close: () => ipcRenderer.send('window:close'),
};

// ---------------------------------------------------------------------------
// Control API (PROMPT 5) — HUMAN ↔ AGENT + TAKE CONTROL
// ---------------------------------------------------------------------------
const controlApi: ControlApi = {
  setMode: (mode: ControlMode) =>
    invoke<{ accepted: boolean; reason?: string }>('control:setMode', mode),
  takeControl: (reason?: string) =>
    invoke<{ accepted: boolean }>('control:takeControl', reason),
  getMode: () => invoke<ControlMode>('control:getMode'),
};

// ---------------------------------------------------------------------------
// Vault API (PROMPT 6) — Credential vault (UI-facing)
// ---------------------------------------------------------------------------
const vaultApi: VaultApi = {
  save: (input: VaultSaveInput) =>
    invoke<VaultSaveResult>('vault:save', input),
  has: (input: VaultHasInput) =>
    invoke<VaultHasResult>('vault:has', input),
  list: () => invoke<VaultListResult>('vault:list'),
  generateAndStore: (input: VaultGenerateInput) =>
    invoke<VaultGenerateResult>('vault:generateAndStore', input),
  fill: (input: VaultFillInput) =>
    invoke<VaultFillResult>('vault:fill', input),
  delete: (id: string) =>
    invoke<VaultDeleteResult>('vault:delete', id),
  prompt: {
    current: () =>
      invoke<PasswordSavePrompt | null>('vault:prompt:current'),
    resolve: (answer: { promptId: string; save: boolean }) =>
      invoke<{ success: boolean; error?: string }>('vault:prompt:resolve', answer),
  },
};

const memoryApi: import('@shared/ipc-types').MemoryApi = {
  current: () => invoke<MemorySavePrompt | null>('memory:prompt:current'),
  resolve: (answer: { promptId: string; save: boolean }) =>
    invoke<{ success: boolean }>('memory:prompt:resolve', answer),
};

// The legacy Electron runtime has no per-profile egress engine — the honest
// shape is "unknown", never a fabricated Tor claim (Tauri runtime implements
// this for real via the privacy_status command).
const privacyApi: import('@shared/ipc-types').PrivacyApi = {
  status: () =>
    Promise.resolve({
      privateEgress: 'unknown',
      agentEgress: 'unknown',
      fetchViaTor: false,
      torAvailable: false,
      torEndpoint: null,
    }),
};

// The legacy Electron runtime has no shield engine — honest zeros, never a
// fabricated block counter (Tauri runtime implements the real one).
const shieldApi: import('@shared/ipc-types').ShieldApi = {
  status: () =>
    Promise.resolve({ enabled: false, totalBlocked: 0, byHost: [], allowlist: [] }),
  setEnabled: () => Promise.resolve({ accepted: false, enabled: false }),
  allowSite: (host: string) => Promise.resolve({ accepted: false, host }),
  disallowSite: (host: string) => Promise.resolve({ accepted: false, host }),
};

const api: ExposedApi = {
  memory: memoryApi,
  privacy: privacyApi,
  shield: shieldApi,
  async getVersion(): Promise<AppVersionInfo> {
    return invoke<AppVersionInfo>('app:version');
  },
  runtimeStatus(): Promise<RuntimeStatus> {
    return invoke<RuntimeStatus>('app:runtimeStatus');
  },

  // UI locale — fire-and-forget; main keeps it for pab:// page builders.
  setLocale(lang: import('@shared/app-locale').AppLocale): void {
    ipcRenderer.send('ui:setLocale', lang);
  },

  // The legacy Electron runtime kept the locale only in this webview's
  // storage; there is no host file to adopt.
  getLocale(): Promise<string> {
    try { return Promise.resolve(localStorage.getItem('pab.lang') ?? 'en'); }
    catch { return Promise.resolve('en'); }
  },

  async ping(
    payload: FoundationPingPayload
  ): Promise<FoundationPingResult> {
    return invoke<FoundationPingResult>('foundation:ping', payload);
  },

  browser: browserApi,
  agent: agentApi,
  control: controlApi,
  vault: vaultApi,
  window: windowApi,

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
