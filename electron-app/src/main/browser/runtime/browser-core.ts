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
import {
  FileStorageAdapter,
  fileStorageFor,
} from '../storage/file-storage-adapter';
import { shouldPersistHistory, getSessionKindForTab } from '../incognito/pure/incognito-policy';

import type {
  TabState,
  HistoryEntry,
  Bookmark,
  DownloadItemState,
  SessionKind,
} from '@shared/browser-types';

const CHROME_HEIGHT = 64; // px — reserved for the React chrome (tabs + address bar)

interface TabRuntime {
  view: WebContentsView;
  nav: NavigationController;
  stack: NavigationStack;
}

export interface BrowserCoreDeps {
  userDataDir: string;
  rendererHtmlPath: string; // production path
  rendererDevUrl?: string; // dev URL (electron-forge start)
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

  private mainWindow: BrowserWindow | null = null;
  private rendererView: WebContentsView | null = null;

  constructor(private deps: BrowserCoreDeps) {
    this.historyStore = new HistoryStore(
      fileStorageFor(deps.userDataDir, 'history.json')
    );
    this.bookmarksStore = new BookmarksStore(
      fileStorageFor(deps.userDataDir, 'bookmarks.json')
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

    // Load the renderer bundle (dev URL or production file).
    if (this.deps.rendererDevUrl) {
      void rendererView.webContents.loadURL(this.deps.rendererDevUrl);
    } else {
      void rendererView.webContents.loadFile(this.deps.rendererHtmlPath);
    }

    // Attach download listener to the default session.
    const defaultSession = this.sessionManager.forKind('default');
    this.sessionManager.configureForBrowser(defaultSession);
    this.downloadManager.attach(defaultSession);

    // Open the first tab to the user's start page.
    this.openTab({ url: 'about:blank' });

    // Resize handler.
    const onResize = (): void => this.layoutViews();
    win.on('resize', onResize);
    this.layoutViews();
  }

  async dispose(): Promise<void> {
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

  openTab(opts: { url?: string; activate?: boolean; incognito?: boolean }): string {
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

  navigateTab(tabId: string, input: string): boolean {
    const runtime = this.tabRuntimes.get(tabId);
    if (!runtime) return false;
    const url = runtime.nav.navigateFromAddressBar(input);
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
    // Create a WebContentsView for the new tab.
    const sessionKind = getSessionKindForTab(tab.isIncognito);
    const ses = this.sessionManager.forKind(sessionKind);
    this.sessionManager.configureForBrowser(ses);

    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        session: ses,
      },
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
        this.tabManager.updateTab(tab.id, { title });
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
    if (tab.pendingUrl) {
      nav.navigateToUrl(tab.pendingUrl);
    }

    // If this tab is active, attach its view to the window.
    if (tab.isActive) {
      this.attachActiveView(tab.id);
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

  private attachActiveView(tabId: string): void {
    const runtime = this.tabRuntimes.get(tabId);
    if (!runtime || !this.mainWindow) return;
    this.mainWindow.contentView.addChildView(runtime.view);
  }

  private layoutViews(): void {
    if (!this.mainWindow || !this.rendererView) return;
    const { width, height } = this.mainWindow.getContentBounds();
    // Renderer chrome at top.
    this.rendererView.setBounds({
      x: 0,
      y: 0,
      width,
      height: CHROME_HEIGHT,
    });
    // Active tab fills the rest.
    const activeId = this.tabManager.getActiveId();
    if (activeId) {
      const runtime = this.tabRuntimes.get(activeId);
      if (runtime) {
        const bounds: Rectangle = {
          x: 0,
          y: CHROME_HEIGHT,
          width,
          height: Math.max(0, height - CHROME_HEIGHT),
        };
        runtime.view.setBounds(bounds);
      }
    }
  }
}
