import type { ExposedApi } from '@shared/ipc-types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Tauri 2 adapter — the same typed ExposedApi contract the Electron preload
 * exposes, backed by `invoke()` commands and `listen()` events.
 *
 * Channel discipline mirrors the preload: this webview (the trusted app
 * shell) may only SUBSCRIBE to the five push channels the backend emits;
 * remote tab webviews never receive the invoke capability at all (see
 * src-tauri/capabilities/).
 */
const ALLOWED_LISTEN_CHANNELS = new Set<string>([
  'agent:state:update',
  'agent:timeline:update',
  'control:mode:update',
  'vault:prompt:update',
  'memory:prompt:update',
]);

export const tauriApi: ExposedApi = {
  getVersion: () => invoke('app_version'),
  ping: (payload) => invoke('foundation_ping', { payload }),
  runtimeStatus: () => invoke('app_runtime_status'),

  browser: {
    listTabs: () => invoke('browser_tabs_list'),
    openTab: (req) => invoke('browser_tabs_open', { req }),
    closeTab: (tabId) => invoke('browser_tabs_close', { req: { tabId } }),
    activateTab: (tabId) => invoke('browser_tabs_activate', { req: { tabId } }),
    navigate: (req) => invoke('browser_navigate', { req }),
    back: (tabId) => invoke('browser_back', { req: { tabId } }),
    forward: (tabId) => invoke('browser_forward', { req: { tabId } }),
    reload: (tabId) => invoke('browser_reload', { req: { tabId } }),
    stop: (tabId) => invoke('browser_stop', { req: { tabId } }),
    queryHistory: (query) => invoke('browser_history_query', { query }),
    deleteHistory: (id) => invoke('browser_history_delete', { id }),
    clearHistory: () => invoke('browser_history_clear'),
    addHistory: (req) => invoke('browser_history_add', { req }),
    listBookmarks: () => invoke('browser_bookmarks_list'),
    addBookmark: (req) => invoke('browser_bookmarks_add', { req }),
    deleteBookmark: (id) => invoke('browser_bookmarks_delete', { id }),
    listDownloads: () => invoke('browser_downloads_list'),
    cancelDownload: (id) => invoke('browser_downloads_cancel', { id }),
    removeDownload: (id) => invoke('browser_downloads_remove', { id }),
  },

  agent: {
    run: (req) => invoke('agent_run', { req }),
    stop: (reason) => invoke('agent_stop', { reason }),
    status: () => invoke('agent_status'),
    listTimeline: () => invoke('agent_timeline_list'),
    researchReport: () => invoke('agent_research_report'),
    pickAttachment: (kind) => invoke('agent_pick_attachment', { kind }),
  },

  control: {
    setMode: (mode) => invoke('control_set_mode', { mode }),
    takeControl: (reason) => invoke('control_take_control', { reason }),
    getMode: () => invoke('control_get_mode'),
  },

  vault: {
    save: (input) => invoke('vault_save', { input }),
    has: (input) => invoke('vault_has', { input }),
    list: () => invoke('vault_list'),
    generateAndStore: (input) => invoke('vault_generate_and_store', { input }),
    fill: (input) => invoke('vault_fill', { input }),
    delete: (id) => invoke('vault_delete', { id }),
    prompt: {
      current: () => invoke('vault_prompt_current'),
      resolve: (answer) => invoke('vault_prompt_resolve', { answer }),
    },
  },

  memory: {
    current: () => invoke('memory_prompt_current'),
    resolve: (answer) => invoke('memory_prompt_resolve', { answer }),
  },

  window: {
    minimize: () => invoke('window_minimize'),
    toggleMaximize: () => invoke('window_toggle_maximize'),
    close: () => invoke('window_close'),
  },

  on: (channel: string, listener: (data: unknown) => void) => {
    if (!ALLOWED_LISTEN_CHANNELS.has(channel)) {
      // Same policy as the preload: refuse unknown subscriptions silently.
      return () => {};
    }
    let unlisten: (() => void) | undefined;
    listen(channel, (event) => {
      listener(event.payload);
    })
      .then((u) => {
        unlisten = u;
      })
      .catch((err: unknown) => {
        console.error('[platform:tauri] listen failed:', channel, err);
      });

    return () => {
      if (unlisten) unlisten();
    };
  },
};
