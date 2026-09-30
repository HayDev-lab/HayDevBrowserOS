/**
 * BrowserCore — orchestrator.
 *
 * Wires the pure logic (TabManager, NavigationStack per tab, HistoryStore,
 * BookmarksStore, DownloadStateManager) to the Electron runtime (WebContentsView
 * per tab, Session, DownloadManager).
 *
 * DEFERRED_RUNTIME: imports `electron`. Unit tests cover the underlying pure
 * modules; integration tests of this class require a running Electron GUI.
 *
 * ARCHITECTURE:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  BrowserWindow (BaseWindow)  [React chrome]            │
 *   │  ┌──────────────────────────────────────────────────┐  │
 *   │  │  WebContentsView (renderer) ─ tabs, address bar  │  │
 *   │  └──────────────────────────────────────────────────┘  │
 *   │  ┌──────────────────────────────────────────────────┐  │
 *   │  │  WebContentsView (active tab's web contents)     │  │
 *   │  └──────────────────────────────────────────────────┘  │
 *   └────────────────────────────────────────────────────────┘
 *
 *   - The renderer view is always attached (it's our React chrome).
 *   - Per-tab web contents views are added/removed from contentView as the
 *     active tab changes. The underlying webContents survives the view
 *     removal so tab state is preserved across switches.
 *
 * SECURITY BASELINE (per Shared Project Context):
 *   - nodeIntegration: false
 *   - contextIsolation: true
 *   - sandbox: true
 *   - webSecurity: true
 *   - allowRunningInsecureContent: false
 *   These flags are applied to EVERY WebContentsView created here.
 */
import {
  app,
  Session,
  Menu,
  BrowserWindow,
  WebContentsView,
  WebContents,
  Rectangle,
} from 'electron';
import path from 'node:path';

import { TabManager } from '../pure/tab-manager';
import { NavigationStack } from '../pure/navigation-stack';
import { NavigationController } from './navigation-controller';
import { SessionManager } from './session-manager';
import { DownloadManager } from './download-manager';
import { DownloadStateManager } from '../pure/download-state-machine';
import { HistoryStore } from '../pure/history-store';
import { BookmarksStore } from '../pure/bookmarks-store';
import { SessionStore, buildSessionTab } from '../pure/session-store';
import { parseUnreadCount } from '@shared/tab-unread';
import {
  FileStorageAdapter,
  fileStorageFor,
} from '../storage/file-storage-adapter';
import { shouldPersistHistory, getSessionKindForTab } from '../incognito/pure/incognito-policy';
import { isOnionHost } from '../darkweb/pure/onion-url';

import type {
  TabState,
  HistoryEntry,
  Bookmark,
  DownloadItemState,
  SessionKind,
  SessionSnapshot,
} from '@shared/browser-types';
import { CHROME_LAYOUT, PAB_NEW_TAB_URL, WEB_APP_PINS } from '@shared/browser-types';

/** Idle time before a background tab is discarded (sleep). */
const SLEEP_TAB_AFTER_MS = 10 * 60 * 1000;
/** Sleep-tab sweep interval. */
const SLEEP_TAB_CHECK_MS = 60 * 1000;

interface TabRuntime {
  view: WebContentsView;
  nav: NavigationController;
  stack: NavigationStack;
}

export interface BrowserCoreDeps {
  userDataDir: string;
  rendererHtmlPath: string; // production path
  rendererDevUrl?: string; // dev URL (electron-forge start)
  /**
   * Selection context-menu action (Explain/Translate/Summarize). Wired in
   * main/index.ts to an agent run. The text is page content — the agent's
   * system prompt treats it as untrusted data.
   */
  onSelectionAction?: (payload: {
    tabId: string;
    action: 'explain' | 'translate' | 'summarize';
    text: string;
  }) => void;
  /** Called for every browsing session so pab:// handlers cover all partitions. */
  onSessionCreated?: (session: Session) => void;
  /**
   * Dark-web subsystem hook (spec §10/§16/§18). Returns a FULLY configured
   * isolated session (fresh memory partition + Tor SOCKS proxy + denied
   * permissions + quarantined downloads) for a dark-web tab, or null when
   * the subsystem is disabled. Never returns the default session — a
   * dark-web tab must never share state with clearnet browsing.
   */
  getDarkWebSession?: (tabId: string) => Session | null;
  /** Whether the dark-web subsystem is enabled (checked before tab open). */
  darkWebAllowed?: () => boolean;
}

export class BrowserCore {
  private readonly tabManager = new TabManager({
    onTabOpened: (tab) => this.handleTabOpened(tab),
    onTabClosed: (id, nextActive) => this.handleTabClosed(id, nextActive),
    onTabActivated: (id, prev) => this.handleTabActivated(id, prev),
    onTabUpdated: (tab) => this.handleTabUpdated(tab),
  });

  private readonly tabRuntimes = new Map<string, TabRuntime>();
  private readonly stacks = new Map<string, NavigationStack>();

  private readonly sessionManager = new SessionManager();
  private readonly downloadState = new DownloadStateManager();
  private readonly downloadManager = new DownloadManager(this.downloadState);

  private readonly historyStore: HistoryStore;
  private readonly bookmarksStore: BookmarksStore;
  private readonly sessionStore: SessionStore;

  private mainWindow: BrowserWindow | null = null;
  private rendererView: WebContentsView | null = null;
  private discardTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: BrowserCoreDeps) {
    this.historyStore = new HistoryStore(
      fileStorageFor(deps.userDataDir, 'history.json')
    );
    this.bookmarksStore = new BookmarksStore(
      fileStorageFor(deps.userDataDir, 'bookmarks.json')
    );
    this.sessionStore = new SessionStore(
      fileStorageFor(deps.userDataDir, 'session.json')
    );
    void this.historyStore.load();
    void this.bookmarksStore.load();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  attachToWindow(win: BrowserWindow): void {
    this.mainWindow = win;

    // Renderer chrome view.
    const rendererView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    win.contentView.addChildView(rendererView);
    this.rendererView = rendererView;

    // Load the renderer bundle (dev URL or production file) and show the
    // main window once the chrome has finished loading. The BrowserWindow is
    // created with show:false; we reveal it here to avoid a blank flash.
    rendererView.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
        this.layoutViews();
      }
    });
    rendererView.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('[browser-core] renderer did-fail-load:', errorCode, errorDescription);
      if (!win.isDestroyed()) {
        win.show();
      }
    });

    if (this.deps.rendererDevUrl) {
      void rendererView.webContents.loadURL(this.deps.rendererDevUrl);
    } else {
      void rendererView.webContents.loadFile(this.deps.rendererHtmlPath);
    }

    // Attach download listener to the default session.
    const defaultSession = this.sessionManager.forKind('default');
    this.sessionManager.configureForBrowser(defaultSession);
    this.deps.onSessionCreated?.(defaultSession);
    this.downloadManager.attach(defaultSession);

    // Restore the previous session (if any); otherwise open a fresh tab.
    void this.restoreSession().then((restored) => {
      if (!restored) {
        this.openTab({ url: PAB_NEW_TAB_URL });
      }
    });

    // Sleep-tab sweep: check idle background tabs once a minute.
    this.discardTimer = setInterval(() => this.discardSweep(), SLEEP_TAB_CHECK_MS);

    // Resize handler.
    const onResize = (): void => this.layoutViews();
    win.on('resize', onResize);
    this.layoutViews();
  }

  /**
   * Restore the persisted session (open tabs + navigation stacks).
   * Returns true if a session was restored, false if none existed.
   *
   * Incognito tabs are NEVER restored (filtered by SessionStore).
   */
  async restoreSession(): Promise<boolean> {
    const snapshot = await this.sessionStore.load();
    if (!snapshot || snapshot.tabs.length === 0) return false;

    for (const tab of snapshot.tabs) {
      // Open with an explicit id so the restored tab keeps its identity.
      this.openTab({
        id: tab.id,
        url: tab.url || tab.pendingUrl || 'about:blank',
        title: tab.title,
        incognito: false, // incognito tabs are filtered out by SessionStore
        activate: false,
        background: true,
      });
      // Restore the navigation stack (back/forward history).
      const runtime = this.tabRuntimes.get(tab.id);
      if (runtime) {
        runtime.nav.restore(tab.navigation);
      }
    }

    // Re-apply the persisted order and active tab.
    if (snapshot.order.length > 0) {
      this.tabManager.reorder(snapshot.order);
    }
    if (snapshot.activeId && this.tabRuntimes.has(snapshot.activeId)) {
      this.tabManager.activateTab(snapshot.activeId);
    } else if (this.tabManager.listTabs().length > 0) {
      this.tabManager.activateTab(this.tabManager.listTabs()[0].id);
    }

    this.layoutViews();
    return true;
  }

  /**
   * Persist the current session (open tabs + navigation stacks) to disk.
   * Incognito tabs are filtered out by SessionStore.
   */
  async saveSession(): Promise<void> {
    // Dark-web tabs are NEVER persisted (same policy as incognito — an
    // onion session has no business surviving an app restart).
    const tabs = this.tabManager.listTabs().filter((t) => !t.isDarkWeb);
    const sessionTabs = tabs.map((tab) => {
      const runtime = this.tabRuntimes.get(tab.id);
      const nav = runtime ? runtime.nav.snapshot() : { backStack: [], current: null, forwardStack: [] };
      return buildSessionTab(tab, nav);
    });
    const snapshot: SessionSnapshot = {
      version: 1,
      tabs: sessionTabs,
      order: this.tabManager.getOrder(),
      activeId: this.tabManager.getActiveId(),
    };
    await this.sessionStore.save(snapshot);
  }

  async dispose(): Promise<void> {
    if (this.discardTimer) {
      clearInterval(this.discardTimer);
      this.discardTimer = null;
    }
    // Persist the session BEFORE tearing down (so the user's tabs survive).
    await this.saveSession();
    await this.sessionManager.discardIncognito();
    this.tabRuntimes.clear();
    this.stacks.clear();
    this.tabManager.snapshot(); // ensure consistent state
    this.rendererView = null;
    this.mainWindow = null;
  }

  // ---------------------------------------------------------------------------
  // Tab operations
  // ---------------------------------------------------------------------------

  openTab(opts: { url?: string; activate?: boolean; incognito?: boolean; darkweb?: boolean; id?: string; title?: string; background?: boolean }): string {
    // Spec §49: when the dark-web subsystem is disabled, an onion/darkweb
    // request degrades to the darkweb SEARCH page (which shows the Tor
    // status) — never to a clearnet tab.
    if (opts.darkweb && this.deps.darkWebAllowed && !this.deps.darkWebAllowed()) {
      return this.tabManager.openTab({ ...opts, darkweb: false, url: 'pab://darkweb' });
    }
    return this.tabManager.openTab(opts);
  }

  closeTab(tabId: string): boolean {
    return this.tabManager.closeTab(tabId);
  }

  activateTab(tabId: string): boolean {
    return this.tabManager.activateTab(tabId);
  }

  listTabs(): TabState[] {
    return this.tabManager.listTabs();
  }

  getTab(tabId: string): TabState | null {
    return this.tabManager.getTab(tabId);
  }

  navigateTab(tabId: string, input: string): boolean {
    const rawInput = typeof input === 'string' ? input : '';
    // Spec §67/§68: an .onion address typed into a NORMAL tab is routed to
    // a NEW isolated dark-web tab (fresh Tor session + indicator), so a
    // clearnet tab can never unexpectedly travel through Tor — and the
    // .onion lookup never leaks to the OS resolver.
    const tab = this.tabManager.getTab(tabId);
    const trimmed = rawInput.trim();
    if (tab && !tab.isDarkWeb && trimmed.length > 0) {
      const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
      try {
        if (isOnionHost(new URL(candidate).hostname)) {
          this.openTab({ url: candidate, darkweb: true, activate: true });
          return true;
        }
      } catch {
        // Not a URL — fall through to the normal path.
      }
    }
    const runtime = this.wakeTab(tabId);
    if (!runtime) return false;
    const url = runtime.nav.navigateFromAddressBar(rawInput);
    if (url === null) return false;
    this.tabManager.updateTab(tabId, { pendingUrl: input, loadState: 'loading' });
    return true;
  }

  back(tabId: string): boolean {
    const runtime = this.tabRuntimes.get(tabId);
    return runtime ? runtime.nav.back() : false;
  }

  forward(tabId: string): boolean {
    const runtime = this.tabRuntimes.get(tabId);
    return runtime ? runtime.nav.forward() : false;
  }

  reload(tabId: string): boolean {
    const runtime = this.tabRuntimes.get(tabId);
    if (!runtime) return false;
    runtime.nav.reload();
    return true;
  }

  stop(tabId: string): boolean {
    const runtime = this.tabRuntimes.get(tabId);
    if (!runtime) return false;
    runtime.nav.stop();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Internal runtime accessor — USED ONLY BY TRUSTED MAIN-PROCESS CODE
  // ---------------------------------------------------------------------------

  /**
   * Resolve a tab id to its underlying `WebContents`.
   *
   * RETURNS A LIVE ELECTRON OBJECT. This method is:
   *   - NOT serializable (WebContents cannot cross IPC).
   *   - NOT exposed via the IPC channel whitelist.
   *   - NOT exported through preload's contextBridge.
   *   - NOT visible to the renderer.
   *   - NOT returned by AgentController.
   *
   * The ONLY legitimate caller is `BrowserActionServiceDeps.resolveWebContents`,
   * wired in `main/index.ts`. That resolver is consumed by
   * `WebContentsActionAdapter` which uses `webContents.executeJavaScript()`
   * with internally-generated static templates ONLY.
   *
   * Returns null if:
   *   - The tab id is unknown.
   *   - The tab was closed (TabRuntime deleted).
   *   - The underlying webContents has been destroyed.
   *
   * SECURITY: This accessor does NOT grant arbitrary JS execution. It only
   * returns a reference to an existing WebContents. All JS execution still
   * goes through WebContentsActionAdapter's static script templates, which
   * never accept caller-supplied JS strings.
   */
  resolveWebContents(tabId: string): WebContents | null {
    const runtime = this.tabRuntimes.get(tabId);
    if (!runtime) return null;
    const wc = runtime.view.webContents;
    if (wc.isDestroyed()) return null;
    return wc;
  }

  /**
   * Reverse lookup: which tab owns this webContents. Used to attribute
   * IPC messages coming from tab preloads (e.g. login form captures).
   * Returns null when the sender is not one of our tab views.
   */
  resolveTabMetaByWebContents(wc: WebContents): { tabId: string; isIncognito: boolean } | null {
    for (const [tabId, runtime] of this.tabRuntimes) {
      if (runtime.view.webContents === wc && !wc.isDestroyed()) {
        const tab = this.tabManager.getTab(tabId);
        return { tabId, isIncognito: tab?.isIncognito ?? false };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // History / Bookmarks / Downloads queries
  // ---------------------------------------------------------------------------

  async queryHistory(opts: {
    limit?: number;
    since?: number;
    search?: string;
  }): Promise<HistoryEntry[]> {
    return this.historyStore.query(opts);
  }

  async deleteHistory(id: string): Promise<boolean> {
    return this.historyStore.delete(id);
  }

  async clearHistory(): Promise<void> {
    return this.historyStore.clear();
  }

  async addHistory(input: { url: string; title: string; visitedAt?: number }) {
    return this.historyStore.add(input);
  }

  async listBookmarks(): Promise<Bookmark[]> {
    return this.bookmarksStore.list();
  }

  async addBookmark(input: { url: string; title: string; folderId?: string | null }): Promise<Bookmark> {
    return this.bookmarksStore.add(input);
  }

  async deleteBookmark(id: string): Promise<boolean> {
    return this.bookmarksStore.delete(id);
  }

  listDownloads(): DownloadItemState[] {
    return this.downloadManager.list();
  }

  cancelDownload(id: string): boolean {
    return this.downloadManager.cancel(id);
  }

  removeDownload(id: string): boolean {
    return this.downloadManager.remove(id);
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handleTabOpened(tab: TabState): void {
    const runtime = this.createTabRuntime(tab);
    this.tabRuntimes.set(tab.id, runtime);
    if (tab.pendingUrl) {
      runtime.nav.navigateToUrl(tab.pendingUrl);
    }

    // If this tab is active, attach its view to the window.
    if (tab.isActive) {
      this.attachActiveView(tab.id);
    }
  }

  /**
   * Create the WebContentsView + navigation controller for a tab (used on
   * open AND on wake from a discarded/sleeping state).
   */
  private createTabRuntime(tab: TabState): TabRuntime {
    // Dark-web tabs get the isolated Tor session from the darkweb subsystem;
    // EVERYTHING else uses the default/incognito selection. A dark-web tab
    // NEVER falls back to a clearnet session (fail-closed, spec §11/§57).
    let ses: Session | null;
    if (tab.isDarkWeb) {
      ses = this.deps.getDarkWebSession?.(tab.id) ?? null;
      if (!ses) {
        // Subsystem disabled mid-flight: keep the tab shell, refuse load.
        this.tabManager.updateTab(tab.id, {
          loadState: 'error',
          error: 'darkweb_disabled',
          title: tab.title || 'Dark Web (disabled)',
        });
        // Create a throwaway isolated (non-proxied) session shell so the
        // view exists but never receives a navigation.
        ses = this.sessionManager.forKind('incognito');
      }
    } else {
      const sessionKind = getSessionKindForTab(tab.isIncognito);
      ses = this.sessionManager.forKind(sessionKind);
    }
    this.sessionManager.configureForBrowser(ses);
    this.deps.onSessionCreated?.(ses);

    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        session: ses,
        // Spec §15: JavaScript is OFF by default in dark-web tabs. No
        // global toggle — per-site enablement is a deliberate future change.
        javascript: !tab.isDarkWeb,
        // Minimal capture-only preload (login form submissions for the
        // vault). Exposes nothing to the page — see tab-preload.ts.
        // NOTE: the forge vite plugin names the output after the input
        // key in vite.tab-preload.config.ts → "tabPreload.js".
        preload: path.join(__dirname, 'tabPreload.js'),
      },
    });
    // Deep-space base color: about:blank (and page-load gaps) render the
    // themed background instead of Chromium's default white flash.
    view.setBackgroundColor(tab.isDarkWeb ? '#0a0410' : '#04060c');

    // Spec §68 — tab isolation guard: a NORMAL tab must never navigate to
    // .onion (it would leak the lookup to the OS resolver and fail anyway).
    // Block it at the will-navigate gate; dark-web tabs are proxied and free.
    if (!tab.isDarkWeb) {
      view.webContents.on('will-navigate', (evt, url) => {
        try {
          if (isOnionHost(new URL(url).hostname)) {
            evt.preventDefault();
            this.tabManager.updateTab(tab.id, {
              loadState: 'error',
              error: 'onion_blocked_in_normal_tab',
            });
          }
        } catch {
          // Non-URL navigations — not an onion concern.
        }
      });
    }

    // Selection context menu → agent actions (Explain/Translate/Summarize).
    view.webContents.on('context-menu', (_evt, params) => {
      const selection = (params.selectionText ?? '').trim();
      if (!selection || !this.deps.onSelectionAction) return;
      const menu = Menu.buildFromTemplate([
        {
          label: 'Explain with Agent',
          click: () =>
            this.deps.onSelectionAction?.({ tabId: tab.id, action: 'explain', text: selection }),
        },
        {
          label: 'Summarize with Agent',
          click: () =>
            this.deps.onSelectionAction?.({ tabId: tab.id, action: 'summarize', text: selection }),
        },
        {
          label: 'Translate to Russian',
          click: () =>
            this.deps.onSelectionAction?.({ tabId: tab.id, action: 'translate', text: selection }),
        },
      ]);
      menu.popup({ window: this.mainWindow ?? undefined });
    });

    const stack = new NavigationStack();
    const nav = new NavigationController(view.webContents, {
      onWillNavigate: (url) => {
        this.tabManager.updateTab(tab.id, {
          pendingUrl: url,
          loadState: 'loading',
        });
      },
      onDidNavigate: (url) => {
        this.tabManager.updateTab(tab.id, {
          url,
          pendingUrl: url,
          loadState: 'committed',
          error: null,
          canGoBack: nav.canGoBack(),
          canGoForward: nav.canGoForward(),
        });
        // Persist to history only if the incognito policy allows it.
        if (shouldPersistHistory(tab)) {
          void this.historyStore.add({ url, title: tab.title });
        }
      },
      ondidNavigateInPage: (url) => {
        this.tabManager.updateTab(tab.id, {
          url,
          canGoBack: nav.canGoBack(),
          canGoForward: nav.canGoForward(),
        });
      },
      onLoadingStateChanged: (isLoading) => {
        this.tabManager.updateTab(tab.id, {
          loadState: isLoading ? 'loading' : 'committed',
        });
      },
      onTitleUpdated: (title) => {
        // Messengers encode unread counts as a "(N) Title" prefix — keep the
        // badge count in tab state alongside the raw title.
        this.tabManager.updateTab(tab.id, {
          title,
          unreadCount: parseUnreadCount(title),
        });
        if (shouldPersistHistory(tab) && tab.url) {
          void this.historyStore.add({ url: tab.url, title });
        }
      },
      onError: (error) => {
        this.tabManager.updateTab(tab.id, { loadState: 'error', error });
      },
    });

    this.tabRuntimes.set(tab.id, { view, nav, stack });

    // Load the initial URL if provided.
    return { view, nav, stack };
  }

  /**
   * Sleep-tab wake: (re)create the runtime for a discarded tab and reload
   * its last URL. No-op when the runtime already exists.
   */
  private wakeTab(tabId: string): TabRuntime | null {
    const existing = this.tabRuntimes.get(tabId);
    if (existing) return existing;
    const tab = this.tabManager.getTab(tabId);
    if (!tab) return null;
    const runtime = this.createTabRuntime(tab);
    this.tabRuntimes.set(tabId, runtime);
    if (tab.url || tab.pendingUrl) {
      runtime.nav.navigateToUrl(tab.url || tab.pendingUrl);
    }
    if (tab.isDiscarded) {
      this.tabManager.updateTab(tabId, { isDiscarded: false, loadState: 'loading' });
    }
    return runtime;
  }


  // ---------------------------------------------------------------------------
  // Sleep tabs — free memory by destroying idle background tab views
  // ---------------------------------------------------------------------------

  /**
   * Discard (sleep) a background tab: destroy its WebContentsView; the tab
   * stays in the strip with isDiscarded=true and wakes on activation.
   * Exempt: active tab, incognito, audio, loading, pinned web apps.
   */
  private discardSweep(): void {
    const now = Date.now();
    for (const tab of this.tabManager.listTabs()) {
      if (tab.isActive || tab.isDiscarded || tab.isIncognito) continue;
      if (tab.isAudioPlaying || tab.loadState === 'loading') continue;
      // Pinned web apps (messengers) stay live for notifications.
      if (WEB_APP_PINS.some((pin) => tab.url.startsWith(pin.url))) continue;
      if (now - tab.lastActivatedAt < SLEEP_TAB_AFTER_MS) continue;
      const runtime = this.tabRuntimes.get(tab.id);
      if (!runtime) continue;
      this.mainWindow?.contentView.removeChildView(runtime.view);
      (runtime.view.webContents as unknown as { destroy: () => void }).destroy?.();
      this.tabRuntimes.delete(tab.id);
      this.tabManager.updateTab(tab.id, { isDiscarded: true });
    }
  }

  private handleTabClosed(tabId: string, _nextActiveId: string | null): void {
    const runtime = this.tabRuntimes.get(tabId);
    if (runtime) {
      this.mainWindow?.contentView.removeChildView(runtime.view);
      // Destroy the webContents to free resources.
      (runtime.view.webContents as unknown as { destroy: () => void }).destroy?.();
      this.tabRuntimes.delete(tabId);
    }
    this.stacks.delete(tabId);
  }

  private handleTabActivated(tabId: string, prevId: string | null): void {
    // Detach the previous active view.
    if (prevId) {
      const prevRuntime = this.tabRuntimes.get(prevId);
      if (prevRuntime && this.mainWindow) {
        this.mainWindow.contentView.removeChildView(prevRuntime.view);
      }
    }
    // A discarded (sleeping) tab recreates its view on activation.
    this.wakeTab(tabId);
    this.attachActiveView(tabId);
    this.layoutViews();
  }

  private handleTabUpdated(tab: TabState): void {
    // In V1, we don't push updates to the renderer via IPC here — that's
    // done lazily via query/list API calls from the renderer. Future stage
    // may add a push-based subscription.
  }

  // ---------------------------------------------------------------------------
  // View management
  // ---------------------------------------------------------------------------

  /**
   * WebContents of the React chrome view. The chrome is a WebContentsView
   * (NOT the window's own webContents), so push events must be addressed
   * here explicitly — win.webContents.send() never reaches it.
   */
  getRendererWebContents(): Electron.WebContents | null {
    return this.rendererView?.webContents ?? null;
  }

  private attachActiveView(tabId: string): void {
    const runtime = this.tabRuntimes.get(tabId);
    if (!runtime || !this.mainWindow) return;
    this.mainWindow.contentView.addChildView(runtime.view);
  }

  private layoutViews(): void {
    if (!this.mainWindow || !this.rendererView) return;
    const { width, height } = this.mainWindow.getContentBounds();
    // The React chrome paints the FULL window (topbar, agent rail, footer);
    // the active tab's web view fills the middle rectangle the chrome leaves
    // free. Bounds stay disjoint so mouse input routes to whichever view
    // owns the region under the cursor.
    this.rendererView.setBounds({ x: 0, y: 0, width, height });
    // Active tab fills the rest.
    const activeId = this.tabManager.getActiveId();
    if (activeId) {
      const runtime = this.tabRuntimes.get(activeId);
      if (runtime) {
        const agentRail =
          width >= CHROME_LAYOUT.agentPanelMinWidth
            ? CHROME_LAYOUT.agentPanelWidth
            : 0;
        // Windows maximized windows inflate by the resize border, so the
        // renderer viewport and getContentBounds() can disagree by the
        // border width. The gutters guarantee the web view never paints
        // over the rail edge or under the footer; the renderer's own
        // background fills the seams.
        const railGutter = 16;
        const bounds: Rectangle = {
          x: 0,
          y: CHROME_LAYOUT.topHeight,
          width: Math.max(0, width - agentRail - railGutter),
          height: Math.max(
            0,
            height -
              CHROME_LAYOUT.topHeight -
              CHROME_LAYOUT.footerHeight -
              railGutter
          ),
        };
        runtime.view.setBounds(bounds);
      }
    }
  }
}
