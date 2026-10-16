/**
 * Pure UI logic for the Neural Cockpit renderer.
 *
 * NO React import. NO electron import. Fully unit-testable.
 *
 * These functions exist so that visual decisions (class names, visibility
 * flags, truncation, state labels) can be UNIT_VERIFIED without mounting
 * React components. Components consume these helpers to compute their
 * rendered output deterministically.
 */
import type { TabLoadState, TabState, DownloadStateName, WebAppPin } from '@shared/browser-types';
import { CHROME_LAYOUT } from '@shared/browser-types';

// ---------------------------------------------------------------------------
// Control mode (HUMAN ↔ AGENT)
// ---------------------------------------------------------------------------
export type ControlMode = 'HUMAN' | 'AGENT';

export interface ControlState {
  mode: ControlMode;
  /** True when the agent loop is currently executing a task. */
  agentRunning: boolean;
  /** True when a TAKE CONTROL interrupt has been requested (latched until cleared). */
  takeoverLatched: boolean;
}

export const DEFAULT_CONTROL_STATE: ControlState = {
  mode: 'HUMAN',
  agentRunning: false,
  takeoverLatched: false,
};

/**
 * Returns the human-readable label for a control mode.
 */
export function getControlModeLabel(mode: ControlMode): string {
  return mode; // 'HUMAN' | 'AGENT' — already display-ready
}

/**
 * Returns the accent color token name associated with a control mode.
 * Used by CSS to switch the visual accent (teal for HUMAN, amber for AGENT).
 */
export function getControlModeAccent(mode: ControlMode): '--nc-accent' | '--nc-agent' {
  return mode === 'AGENT' ? '--nc-agent' : '--nc-accent';
}

/**
 * TAKE CONTROL button is visible whenever the agent is in AGENT mode OR
 * a task is running. The button is ALWAYS rendered in the UI shell, but its
 * visual prominence (filled vs outline, glow vs flat) escalates with the
 * conditions below.
 *
 * Visibility levels:
 *   - 'hidden'   → not rendered (only when HUMAN and no agent activity)
 *   - 'subtle'   → outline button, low prominence
 *   - 'elevated' → filled button with subtle glow (agent is running)
 *   - 'critical' → filled button with strong glow + pulse (takeoverLatched or AGENT+running)
 */
export type TakeControlVisibility = 'hidden' | 'subtle' | 'elevated' | 'critical';

export function getTakeControlVisibility(state: ControlState): TakeControlVisibility {
  if (state.mode === 'HUMAN' && !state.agentRunning && !state.takeoverLatched) {
    return 'hidden';
  }
  if (state.takeoverLatched) {
    return 'critical';
  }
  if (state.mode === 'AGENT' && state.agentRunning) {
    return 'critical';
  }
  if (state.mode === 'AGENT') {
    return 'elevated';
  }
  // HUMAN mode but agentRunning true (e.g. shutdown in progress).
  return 'subtle';
}

/**
 * Returns true if a control-mode transition is allowed.
 * HUMAN → AGENT: allowed only when no agent task is currently running.
 * AGENT → HUMAN (TAKE CONTROL): ALWAYS allowed — takeover is the user's
 *   unconditional escape hatch. Latches `takeoverLatched=true` so the UI
 *   keeps showing the critical state until the agent loop has fully aborted.
 */
export function canTransitionControlMode(
  from: ControlState,
  to: ControlMode
): boolean {
  if (from.mode === to) return false;
  if (to === 'HUMAN') return true; // TAKE CONTROL — always allowed
  // to === 'AGENT'
  return !from.agentRunning;
}

/**
 * Apply a TAKE CONTROL request. Returns the new control state.
 * Sets mode=HUMAN, latches takeover, clears agentRunning.
 * The caller is responsible for actually aborting the agent task; this
 * function only updates the deterministic UI state.
 */
export function applyTakeControl(state: ControlState): ControlState {
  return {
    mode: 'HUMAN',
    agentRunning: false,
    takeoverLatched: true,
  };
}

/**
 * Clear the takeover latch once the agent loop has fully stopped and the
 * user has acknowledged the takeover.
 */
export function clearTakeoverLatch(state: ControlState): ControlState {
  return { ...state, takeoverLatched: false };
}

/**
 * Switch to AGENT mode. Refuses if an agent task is running.
 */
export function switchToAgent(state: ControlState): ControlState {
  if (!canTransitionControlMode(state, 'AGENT')) return state;
  return { ...state, mode: 'AGENT', takeoverLatched: false };
}

/**
 * Mark the agent task as started/stopped. Stopping clears the running flag
 * but does NOT switch back to HUMAN — the user must explicitly TAKE CONTROL.
 */
export function setAgentRunning(
  state: ControlState,
  running: boolean
): ControlState {
  return { ...state, agentRunning: running };
}

// ---------------------------------------------------------------------------
// Tab styling
// ---------------------------------------------------------------------------
export interface TabClassNameInput {
  active: boolean;
  loadState: TabLoadState;
  isIncognito: boolean;
  isAudioPlaying: boolean;
  hovered: boolean;
  /** Dark-web (Tor) tab — purple accent + indicator (spec §67). */
  isDarkWeb?: boolean;
}

/**
 * Compute the className for a tab button based on its state.
 * Returns a space-separated list of modifier class names (without the base
 * `tab` class — the caller adds that).
 */
export function getTabModifiers(input: TabClassNameInput): string {
  const mods: string[] = [];
  if (input.active) mods.push('tab--active');
  if (input.loadState === 'loading') mods.push('tab--loading');
  if (input.loadState === 'error') mods.push('tab--error');
  if (input.loadState === 'committed' && input.active) mods.push('tab--committed');
  if (input.isIncognito) mods.push('tab--incognito');
  if (input.isDarkWeb) mods.push('tab--darkweb');
  if (input.isAudioPlaying) mods.push('tab--audio');
  if (input.hovered) mods.push('tab--hovered');
  return mods.join(' ');
}

/**
 * Truncate a tab title to a maximum character count.
 * Returns the truncated string with an ellipsis if it exceeds the limit.
 */
export function truncateTitle(title: string, maxLen: number): string {
  if (typeof title !== 'string' || title.length === 0) return '';
  if (title.length <= maxLen) return title;
  if (maxLen <= 1) return '…';
  return title.slice(0, maxLen - 1) + '…';
}

/**
 * Returns the favicon fallback character (uppercase first letter of host,
 * or '?' if no URL).
 *
 * Safe against malformed URLs — never throws.
 */
export function getFaviconFallback(displayUrl: string): string {
  if (!displayUrl) return '?';
  // Internal pages get a house glyph instead of a host letter.
  if (displayUrl.startsWith('pab://')) return '⌂';
  try {
    const u = new URL(displayUrl);
    const host = u.host;
    if (!host) return '?';
    const ch = host.charAt(0).toUpperCase();
    return ch || '?';
  } catch {
    return '?';
  }
}

/**
 * Returns the display title for a tab. Falls back through:
 *   1. tab.title (if non-empty)
 *   2. tab.url (if non-empty)
 *   3. tab.pendingUrl (if non-empty)
 *   4. fallbackLabel (localized 'New Tab' — passed by the caller)
 */
export function getTabDisplayTitle(tab: TabState, fallbackLabel = 'New Tab'): string {
  if (tab.title && tab.title.length > 0) return tab.title;
  if (tab.url && tab.url.length > 0) return tab.url;
  if (tab.pendingUrl && tab.pendingUrl.length > 0) return tab.pendingUrl;
  return fallbackLabel;
}

// ---------------------------------------------------------------------------
// Command bar (address bar) state
// ---------------------------------------------------------------------------
export type CommandBarStateName =
  | 'idle'
  | 'focused'
  | 'loading'
  | 'navigating'
  | 'invalid'
  | 'secure'
  | 'insecure';

export interface CommandBarStateInput {
  isFocused: boolean;
  isLoading: boolean;
  hasUrl: boolean;
  isHttps: boolean;
  isIncognito: boolean;
  input: string;
  /** False when the committed URL is an internal page (about:blank, …). */
  isWebUrl?: boolean;
}

/**
 * Compute the command-bar visual state.
 *
 *   idle       → no tab, no focus, no input
 *   focused    → user is typing
 *   loading    → tab is currently loading
 *   navigating → input non-empty but not yet submitted
 *   invalid    → input looks like a blocked protocol (javascript:, data:, ...)
 *   secure     → committed https URL, not focused
 *   insecure   → committed http URL, not focused
 */
export function getCommandBarState(input: CommandBarStateInput): CommandBarStateName {
  // Check for blocked-protocol patterns first.
  const trimmed = input.input.trim().toLowerCase();
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('vbscript:') ||
    trimmed.startsWith('blob:')
  ) {
    return 'invalid';
  }
  if (input.isLoading) return 'loading';
  if (input.isFocused) {
    return trimmed.length > 0 ? 'navigating' : 'focused';
  }
  if (!input.hasUrl) return 'idle';
  // Internal pages (about:blank and friends) carry no security signal —
  // showing the warning border on them is noise.
  if (input.isWebUrl === false) return 'idle';
  return input.isHttps ? 'secure' : 'insecure';
}

/**
 * Returns the className modifier for the command bar state.
 */
export function getCommandBarStateModifier(state: CommandBarStateName): string {
  return `commandbar--${state}`;
}

// ---------------------------------------------------------------------------
// Panel state
// ---------------------------------------------------------------------------
export type PanelStateName = 'closed' | 'empty' | 'list' | 'loading';

export function getPanelState(
  open: boolean,
  itemCount: number,
  isLoading: boolean = false
): PanelStateName {
  if (!open) return 'closed';
  if (isLoading) return 'loading';
  if (itemCount === 0) return 'empty';
  return 'list';
}

/**
 * Returns true if a panel should render its empty-state placeholder.
 */
export function isPanelEmptyState(
  open: boolean,
  itemCount: number
): boolean {
  return open && itemCount === 0;
}

// ---------------------------------------------------------------------------
// Incognito visual state
// ---------------------------------------------------------------------------
export interface IncognitoVisualState {
  /** True when ANY open tab is incognito. */
  anyIncognito: boolean;
  /** True when the ACTIVE tab is incognito. */
  activeIncognito: boolean;
}

export function getIncognitoVisualState(
  tabs: TabState[],
  activeTabId: string | null
): IncognitoVisualState {
  let anyIncognito = false;
  let activeIncognito = false;
  for (const t of tabs) {
    if (t.isIncognito) {
      anyIncognito = true;
      if (t.id === activeTabId) activeIncognito = true;
    }
  }
  return { anyIncognito, activeIncognito };
}

/**
 * Returns the className modifier for the app root when incognito is active.
 * Used to switch the entire chrome to the incognito accent.
 */
export function getAppIncognitoModifier(state: IncognitoVisualState): string {
  if (state.activeIncognito) return 'app--incognito-active';
  if (state.anyIncognito) return 'app--incognito-any';
  return '';
}

// ---------------------------------------------------------------------------
// Download state styling
// ---------------------------------------------------------------------------
export function getDownloadStateColorClass(state: DownloadStateName): string {
  return `download-item__state--${state}`;
}

export function isDownloadTerminal(state: DownloadStateName): boolean {
  return state === 'completed' || state === 'cancelled' || state === 'interrupted';
}

export function isDownloadInProgress(state: DownloadStateName): boolean {
  return state === 'pending' || state === 'progressing';
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / Math.pow(1024, i);
  const decimals = i === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

export function formatPercent(received: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(received) || received < 0) return 0;
  return Math.min(100, Math.round((received / total) * 100));
}

/**
 * Format a timestamp as a short relative label.
 * Returns 'just now', '5m ago', '2h ago', '3d ago', or a date.
 */
export interface RelativeTimeLabels {
  justNow: string;
  mAgo: string;
  hAgo: string;
  dAgo: string;
}

const DEFAULT_RELATIVE_LABELS: RelativeTimeLabels = {
  justNow: 'just now',
  mAgo: '{n}m ago',
  hAgo: '{n}h ago',
  dAgo: '{n}d ago',
};

export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now(),
  labels?: Partial<RelativeTimeLabels>
): string {
  const L: RelativeTimeLabels = { ...DEFAULT_RELATIVE_LABELS, ...labels };
  const fmt = (tpl: string, n: number) => tpl.replaceAll('{n}', String(n));
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const diff = now - timestamp;
  if (diff < 0) return L.justNow;
  if (diff < 60_000) return L.justNow;
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return fmt(L.mAgo, m);
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return fmt(L.hAgo, h);
  }
  if (diff < 7 * 86_400_000) {
    const d = Math.floor(diff / 86_400_000);
    return fmt(L.dAgo, d);
  }
  // Beyond a week — fall back to a date.
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Responsive layout
// ---------------------------------------------------------------------------
export type LayoutKind = 'narrow' | 'normal' | 'wide';

/**
 * Pick a layout kind based on the renderer chrome's available width.
 *
 *   narrow: < 980px  — agent panel hidden, secondary controls collapse
 *   normal: 980–1440 — agent panel docked right
 *   wide:    > 1440  — agent panel + extra padding
 */
export function pickLayoutKind(width: number): LayoutKind {
  if (width < CHROME_LAYOUT.agentPanelMinWidth) return 'narrow';
  if (width < 1440) return 'normal';
  return 'wide';
}

/**
 * Returns the className modifier for the app root based on layout kind.
 */
export function getLayoutModifier(kind: LayoutKind): string {
  return `app--${kind}`;
}

// ---------------------------------------------------------------------------
// Web app pins (tab strip quick launch)
// ---------------------------------------------------------------------------

/**
 * Find the tab already showing a pinned web app (origin-prefix match on
 * committed or pending URL). Returns the tab id, or null when the app has
 * no open tab — the caller then opens a fresh one.
 */
export function findWebAppTabId(tabs: TabState[], app: WebAppPin): string | null {
  const tab = tabs.find(
    (t) => t.url.startsWith(app.url) || t.pendingUrl.startsWith(app.url)
  );
  return tab?.id ?? null;
}

/** True when the given (active) tab URL belongs to the pinned app. */
export function isWebAppTabActive(activeTabUrl: string, app: WebAppPin): boolean {
  return activeTabUrl.startsWith(app.url);
}

// ---------------------------------------------------------------------------
// Side panels (history / bookmarks / downloads)
// ---------------------------------------------------------------------------
export type PanelKind = 'history' | 'bookmarks' | 'downloads' | 'vault';

/**
 * Returns true if the given panel kind matches the active panel.
 */
export function isPanelActive(
  active: PanelKind | null,
  kind: PanelKind
): boolean {
  return active === kind;
}
