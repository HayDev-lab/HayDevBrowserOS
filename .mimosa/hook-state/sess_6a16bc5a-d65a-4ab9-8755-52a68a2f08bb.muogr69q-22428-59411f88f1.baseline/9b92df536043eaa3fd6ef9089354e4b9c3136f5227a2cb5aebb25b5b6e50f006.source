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
  /**
   * True if the tab runs in the isolated Dark Web context: fresh in-memory
   * session, SOCKS5 (Tor) fixed proxy with loopback forced through it,
   * JavaScript OFF, downloads quarantined. Never set on normal tabs — a
   * normal tab must never route through Tor (spec §68).
   */
  isDarkWeb?: boolean;
  /** Whether the tab is currently the active tab. */
  isActive: boolean;
  /** Whether the tab is loading audio (placeholder for V2 audio indicator). */
  isAudioPlaying: boolean;
  /**
   * Unread notifications for this tab, parsed from the page title prefix
   * (e.g. "(3) WhatsApp"). 0 = no unread indicator. Not persisted across
   * sessions — restored tabs start at 0 until the page updates its title.
   */
  unreadCount: number;
  /**
   * True when the tab's WebContentsView was destroyed to free memory
   * (sleep tab) — the tab stays in the strip and wakes on activation.
   */
  isDiscarded: boolean;
  createdAt: number;
  lastActivatedAt: number;
}

// ---------------------------------------------------------------------------
// Chrome layout geometry
// ---------------------------------------------------------------------------

/**
 * Chrome geometry shared between the main process (WebContentsView layout)
 * and the renderer (pickLayoutKind). Values MUST stay in sync with the
 * --nc-chrome-* / --nc-agent-panel-width tokens in
 * renderer/src/design-tokens.css.
 */
export const CHROME_LAYOUT = {
  /** Custom title bar (brand + nav + status + window controls). */
  titlebarHeight: 40,
  /** Title bar (40) + tab strip (44) + toolbar (44) reserved at the top. */
  topHeight: 128,
  /** Status footer reserved at the bottom of the window. */
  footerHeight: 24,
  /** Width of the docked agent rail (right column). */
  agentPanelWidth: 360,
  /** Below this content width the agent rail is hidden (narrow layout). */
  agentPanelMinWidth: 980,
} as const;

/** Internal New Tab Page (served by the pab:// protocol handler). */
export const PAB_NEW_TAB_URL = 'pab://newtab';

/** Internal Dark Web Search page (isolated search UI, pab:// protocol). */
export const PAB_DARKWEB_URL = 'pab://darkweb';

// ---------------------------------------------------------------------------
// Web app pins (tab strip quick launch)
// ---------------------------------------------------------------------------

/** A pinned web app shortcut rendered in the tab strip. */
export interface WebAppPin {
  id: 'whatsapp' | 'telegram' | 'haydev' | 'darkweb';
  label: string;
  /** Origin the app lives at; also the URL opened on first launch. */
  url: string;
}

export const WEB_APP_PINS: readonly WebAppPin[] = [
  // Matrix NTP concept: messengers sit right next to the New Tab area —
  // [ New Tab | WhatsApp | Telegram | + ] — search pins follow.
  { id: 'whatsapp', label: 'WhatsApp', url: 'https://web.whatsapp.com/' },
  { id: 'telegram', label: 'Telegram', url: 'https://web.telegram.org/' },
  {
    id: 'haydev',
    label: 'HayDev Search',
    url: 'pab://search',
  },
  { id: 'darkweb', label: 'Dark Web Search', url: 'pab://darkweb' },
] as const;

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
// Session restore
// ---------------------------------------------------------------------------

/**
 * Per-tab navigation state captured for session restore. Mirrors
 * `NavigationStackSnapshot` (pure module) so the runtime can persist and
 * restore back/forward history across app restarts.
 */
export interface SessionTabNavigation {
  backStack: string[];
  current: string | null;
  forwardStack: string[];
}

/**
 * A single tab's persisted state for session restore.
 *
 * Incognito tabs are NEVER persisted (privacy policy — see
 * `incognito-policy.ts`). The runtime filters them out before saving.
 */
export interface SessionTab {
  id: string;
  url: string;
  pendingUrl: string;
  title: string;
  isIncognito: boolean;
  navigation: SessionTabNavigation;
}

/**
 * The full persisted session: ordered tab list + active tab id.
 * Written to `userData/session.json` on quit, read on startup.
 */
export interface SessionSnapshot {
  version: 1;
  tabs: SessionTab[];
  order: string[];
  activeId: string | null;
}

// ---------------------------------------------------------------------------
// IPC payloads (forward declarations — full channel list lives in ipc-types.ts)
// ---------------------------------------------------------------------------

export interface OpenTabRequest {
  url: string;
  /** Activate the new tab immediately. Default: true. */
  activate?: boolean;
  /** Open in an Incognito partition. Default: false. */
  incognito?: boolean;
  /** Open in the isolated Dark Web (Tor) context. Default: false. */
  darkweb?: boolean;
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
