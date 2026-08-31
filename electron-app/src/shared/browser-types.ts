/**
 * Domain types for the Browser Core (PROMPT 2).
 *
 * These types are pure data — no Electron imports — so they can be shared
 * freely across main / preload / renderer / tests without pulling the
 * Electron runtime into the type graph.
 *
 * SECURITY: never put credentials, file paths, or Node objects here.
 */

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export type TabLoadState = 'idle' | 'loading' | 'committed' | 'error';

export interface TabState {
  /** Stable unique id (uuid v4). */
  id: string;
  /** Last committed URL (post-redirect). Empty for a fresh tab. */
  url: string;
  /** URL the user typed / requested. May differ from `url` during loading. */
  pendingUrl: string;
  /** Page title. Defaults to pending URL until first title commit. */
  title: string;
  /** Whether the underlying WebContents is currently loading. */
  loadState: TabLoadState;
  /** Last navigation error string, if `loadState === 'error'`. */
  error: string | null;
  /** True if back is available in this tab's navigation stack. */
  canGoBack: boolean;
  /** True if forward is available in this tab's navigation stack. */
  canGoForward: boolean;
  /** True if the tab belongs to an Incognito session. */
  isIncognito: boolean;
  /** Whether the tab is currently the active tab. */
  isActive: boolean;
  /** Whether the tab is loading audio (placeholder for V2 audio indicator). */
  isAudioPlaying: boolean;
  createdAt: number;
  lastActivatedAt: number;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  /** Epoch milliseconds of the most recent visit. */
  visitedAt: number;
  /** Total number of visits to this URL. */
  visitCount: number;
}

export interface HistoryQuery {
  limit?: number;
  since?: number;
  /** If set, only entries with URL or title containing this substring. */
  search?: string;
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  /** Optional folder id. `null` for the root. */
  folderId: string | null;
  addedAt: number;
}

export interface BookmarkInput {
  url: string;
  title: string;
  folderId?: string | null;
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

export type DownloadStateName =
  | 'pending'
  | 'progressing'
  | 'completed'
  | 'cancelled'
  | 'interrupted';

export interface DownloadItemState {
  id: string;
  url: string;
  filename: string;
  state: DownloadStateName;
  totalBytes: number;
  receivedBytes: number;
  startTime: number;
  endTime: number | null;
  savePath: string | null;
  mimeType: string | null;
  error: string | null;
  /** Tab that originated the download, if known. */
  tabId: string | null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Browser session kind. `default` is the persistent normal session;
 * `incognito` is an in-memory partition cleared on close.
 *
 * NOTE: actual Electron partition strings are owned by `SessionManager`
 * (runtime module); this enum is the pure-logic kind only.
 */
export type SessionKind = 'default' | 'incognito';

// ---------------------------------------------------------------------------
// IPC payloads (forward declarations — full channel list lives in ipc-types.ts)
// ---------------------------------------------------------------------------

export interface OpenTabRequest {
  url: string;
  /** Activate the new tab immediately. Default: true. */
  activate?: boolean;
  /** Open in an Incognito partition. Default: false. */
  incognito?: boolean;
  /** Background-only creation flag (opposite of `activate`). */
  background?: boolean;
}

export interface NavigateRequest {
  tabId: string;
  url: string;
}

export interface TabIdRequest {
  tabId: string;
}

export interface HistoryAddRequest {
  url: string;
  title: string;
  /** Optional override for tests. Default: now. */
  visitedAt?: number;
}

export interface BookmarkAddRequest {
  url: string;
  title: string;
  folderId?: string | null;
}
