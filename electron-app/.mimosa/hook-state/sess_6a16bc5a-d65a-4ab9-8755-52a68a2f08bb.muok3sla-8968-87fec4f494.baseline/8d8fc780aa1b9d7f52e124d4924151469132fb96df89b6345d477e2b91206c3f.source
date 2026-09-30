import { platformApi } from '../platform';
/**
 * Browser UI store — client-side state mirror of the main process state.
 *
 * Polls `platformApi.browser.listTabs()` etc. on a low-frequency interval.
 * Future stages may add push-based subscription via `platformApi.on(...)`.
 */
import { useEffect, useState, useCallback } from 'react';
import type {
  TabState,
  HistoryEntry,
  Bookmark,
  DownloadItemState,
  OpenTabRequest,
} from '@shared/ipc-types';

const REFRESH_MS = 800;

export interface BrowserUiState {
  tabs: TabState[];
  activeTabId: string | null;
  history: HistoryEntry[];
  bookmarks: Bookmark[];
  downloads: DownloadItemState[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshTabs: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshBookmarks: () => Promise<void>;
  refreshDownloads: () => Promise<void>;
}

function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): [T | null, string | null] {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loader()
      .then((v) => {
        if (!cancelled) setValue(v);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, deps);
  return [value, error];
}

export function useBrowserUi(): BrowserUiState {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [downloads, setDownloads] = useState<DownloadItemState[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshTabs = useCallback(async () => {
    try {
      setTabs(await platformApi.browser.listTabs());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await platformApi.browser.queryHistory({ limit: 200 }));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshBookmarks = useCallback(async () => {
    try {
      setBookmarks(await platformApi.browser.listBookmarks());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshDownloads = useCallback(async () => {
    try {
      setDownloads(await platformApi.browser.listDownloads());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([
      refreshTabs(),
      refreshHistory(),
      refreshBookmarks(),
      refreshDownloads(),
    ]);
  }, [refreshTabs, refreshHistory, refreshBookmarks, refreshDownloads]);

  // Initial load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling refresh — V1 uses polling; PROMPT 3 will add push events.
  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const activeTab = tabs.find((t) => t.isActive) ?? null;

  return {
    tabs,
    activeTabId: activeTab?.id ?? null,
    history,
    bookmarks,
    downloads,
    isLoading: false,
    error,
    refresh,
    refreshTabs,
    refreshHistory,
    refreshBookmarks,
    refreshDownloads,
  };
}

// ---------------------------------------------------------------------------
// Action helpers — thin wrappers around platformApi.browser for ergonomics.
// ---------------------------------------------------------------------------
export function useBrowserActions() {
  return {
    openTab: (req: OpenTabRequest) => platformApi.browser.openTab(req),
    closeTab: (tabId: string) => platformApi.browser.closeTab(tabId),
    activateTab: (tabId: string) => platformApi.browser.activateTab(tabId),
    navigate: (tabId: string, url: string) =>
      platformApi.browser.navigate({ tabId, url }),
    back: (tabId: string) => platformApi.browser.back(tabId),
    forward: (tabId: string) => platformApi.browser.forward(tabId),
    reload: (tabId: string) => platformApi.browser.reload(tabId),
    stop: (tabId: string) => platformApi.browser.stop(tabId),
    addBookmark: (url: string, title: string) =>
      platformApi.browser.addBookmark({ url, title }),
    deleteBookmark: (id: string) => platformApi.browser.deleteBookmark(id),
    deleteHistory: (id: string) => platformApi.browser.deleteHistory(id),
    clearHistory: () => platformApi.browser.clearHistory(),
    cancelDownload: (id: string) => platformApi.browser.cancelDownload(id),
    removeDownload: (id: string) => platformApi.browser.removeDownload(id),
  };
}
