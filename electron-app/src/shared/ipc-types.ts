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
import type {
  AgentRunRequest,
  AgentRunResult,
  AgentStatusSnapshot,
  AgentTimelineEntry,
  ControlMode,
  ControlModeUpdate,
} from './agent-types';
import type { MemorySavePrompt } from './memory-types';
import type {
  CredentialMetadata,
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
} from './vault-types';

// Re-export all browser + agent + vault types for convenience.
export * from './browser-types';
export * from './agent-types';
export * from './vault-types';
export * from './research-types';

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
export type ChannelName = FoundationChannel | BrowserChannel | AgentChannel | VaultChannel;

// ---------------------------------------------------------------------------
// Agent Runtime channels (PROMPT 5)
// ---------------------------------------------------------------------------
export type AgentChannel =
  // Agent run lifecycle
  | 'agent:run'
  | 'agent:stop'
  | 'agent:status'
  | 'agent:timeline:list'
  | 'agent:research:report'
  // Control mode
  | 'control:setMode'
  | 'control:takeControl'
  | 'control:getMode';

// ---------------------------------------------------------------------------
// Vault channels (PROMPT 6)
// ---------------------------------------------------------------------------
export type VaultChannel =
  | 'vault:save'
  | 'vault:has'
  | 'vault:list'
  | 'vault:generateAndStore'
  | 'vault:fill'
  | 'vault:delete';

// Push-event channels (main → renderer via webContents.send).
export type AgentPushChannel =
  | 'agent:state:update'
  | 'agent:timeline:update'
  | 'control:mode:update';

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

// ---------------------------------------------------------------------------
// Agent Runtime API (PROMPT 5)
// ---------------------------------------------------------------------------
export interface AgentApi {
  /** Start an agent run with a natural-language command. */
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  /** Stop the current agent run (graceful). */
  stop(reason?: string): Promise<{ accepted: boolean }>;
  /** Get the current agent status snapshot. */
  status(): Promise<AgentStatusSnapshot>;
  /** Get the current timeline. */
  listTimeline(): Promise<AgentTimelineEntry[]>;
  /** Last Deep Research report (PROMPT 9); null before the first run. */
  researchReport(): Promise<import('./research-types').ResearchReport | null>;
  /**
   * Native file/image picker for chat attachments. Returns an opaque
   * descriptor (no filesystem paths); content stays in the MAIN process
   * registry and is consumed by the next run via attachmentIds.
   */
  releaseAttachment?(id: string): Promise<void>;
  pickAttachment(kind?: 'file' | 'image'): Promise<{
    attachment: import('./newtab-bridge').NewTabAttachment | null;
  }>;
}

// ---------------------------------------------------------------------------
// Window API — frameless Matrix title bar controls
// ---------------------------------------------------------------------------
export interface WindowApi {
  minimize(): void;
  toggleMaximize(): void;
  /** Synchronize native tab bounds with the renderer's docked panel. */
  setAgentPanelOpen?(open: boolean): Promise<void> | void;
  close(): void;
}

/** Managed-runtime health for the chrome footer. */
export interface RuntimeStatus {
  /** Configured Perplexica endpoint (e.g. http://127.0.0.1:3000). */
  endpoint: string;
  reachable: boolean;
  /**
   * Managed-engine phase for the footer chip: 'ready' (engine serving),
   * 'starting' (engine booting — not an outage), 'offline'. Optional so the
   * Electron runtime (which does not send it) keeps working unchanged.
   */
  state?: 'ready' | 'starting' | 'offline';
}

// ---------------------------------------------------------------------------
// Control API (PROMPT 5) — HUMAN ↔ AGENT + TAKE CONTROL
// ---------------------------------------------------------------------------
export interface ControlApi {
  /** Switch to AGENT or HUMAN mode. */
  setMode(mode: ControlMode): Promise<{ accepted: boolean; reason?: string }>;
  /** TAKE CONTROL — abort the current agent run and switch to HUMAN. */
  takeControl(reason?: string): Promise<{ accepted: boolean }>;
  /** Get the current control mode. */
  getMode(): Promise<ControlMode>;
}

// ---------------------------------------------------------------------------
// Vault API (PROMPT 6) — UI-facing credential vault
// ---------------------------------------------------------------------------
export interface VaultApi {
  /** Save a credential (user-initiated with plaintext password). */
  save(input: VaultSaveInput): Promise<VaultSaveResult>;
  /** Check if a credential exists for a domain. */
  has(input: VaultHasInput): Promise<VaultHasResult>;
  /** List all saved credentials (metadata only — no passwords). */
  list(): Promise<VaultListResult>;
  /** Generate a secure password and store it. */
  generateAndStore(input: VaultGenerateInput): Promise<VaultGenerateResult>;
  /** Fill the login form on a tab with stored credentials. */
  fill(input: VaultFillInput): Promise<VaultFillResult>;
  /** Delete a credential by id. */
  delete(id: string): Promise<VaultDeleteResult>;
  /** Save-password prompt (login capture). No password ever crosses IPC. */
  prompt: {
    current(): Promise<PasswordSavePrompt | null>;
    resolve(answer: {
      promptId: string;
      save: boolean;
    }): Promise<{ success: boolean; error?: string }>;
  };
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

  // Agent Runtime (PROMPT 5)
  agent: AgentApi;
  /** Available in the native Tauri runtime. */
  poker?: import('./poker-types').PokerApi;

  // Control mode (PROMPT 5)
  control: ControlApi;

  // Vault (PROMPT 6)
  vault: VaultApi;

  // Agent memory (confirmation prompt for memory.save)
  memory: MemoryApi;

  // Privacy / egress state (real policy readout, PROMPT 02)
  privacy: PrivacyApi;

  // Shield (real network blocking stats + control, PROMPT 07)
  shield: ShieldApi;

  // Frameless window controls (Matrix title bar)
  window: WindowApi;

  // Managed runtime health (footer status)
  runtimeStatus(): Promise<RuntimeStatus>;

  // UI locale — fire-and-forget push so pab:// pages match the chrome language
  setLocale(lang: import('./app-locale').AppLocale): void;
  /** The host-persisted locale ("en" | "ru" | "hy") — durable across restarts. */
  getLocale(): Promise<string>;

  // Event subscription (whitelisted channels only)
  on(channel: string, listener: (data: unknown) => void): () => void;
}

declare global {
  interface Window {
    api: ExposedApi;
  }
}

export const API_NAMESPACE = 'api' as const;

// ---------------------------------------------------------------------------
// Memory API — agent memory confirmation prompt
// ---------------------------------------------------------------------------
export interface MemoryApi {
  current(): Promise<MemorySavePrompt | null>;
  resolve(answer: {
    promptId: string;
    save: boolean;
  }): Promise<{ success: boolean }>;
}

// ---------------------------------------------------------------------------
// Privacy API — real per-profile egress policy + Tor gateway state
// ---------------------------------------------------------------------------
export interface PrivacyStatus {
  /** "direct" | "tor-if-available" | "tor-strict" | "socks5" */
  privateEgress: string;
  agentEgress: string;
  fetchViaTor: boolean;
  torAvailable: boolean;
  torEndpoint: string | null;
  /** Fingerprint-noise layer for NEW private webviews (runtime toggle). */
  fingerprintNoise: boolean;
}

export interface PrivacyApi {
  status(): Promise<PrivacyStatus>;
  /** Toggle fingerprint noise for NEW private webviews; persists. */
  setFingerprintNoise(enabled: boolean): Promise<{ accepted: boolean; fingerprintNoise: boolean }>;
}

// ---------------------------------------------------------------------------
// Shield API — real network-level ad/tracker blocking stats + control
// ---------------------------------------------------------------------------
export interface ShieldStatus {
  protectedTabs?: number;
  storeError?: string | null;
  enabled: boolean;
  totalBlocked: number;
  byHost: { host: string; blocked: number }[];
  allowlist: string[];
  scope?: string;
}

export interface ShieldApi {
  status(): Promise<ShieldStatus>;
  setEnabled(enabled: boolean): Promise<{ accepted: boolean; enabled: boolean }>;
  allowSite(host: string): Promise<{ accepted: boolean; host: string }>;
  disallowSite(host: string): Promise<{ accepted: boolean; host: string }>;
}

