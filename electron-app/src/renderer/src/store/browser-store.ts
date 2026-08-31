/**
 * Browser UI store — client-side state mirror of the main process state.
 *
 * Polls `window.api.browser.listTabs()` etc. on a low-frequency interval.
 * Future stages may add push-based subscription via `window.api.on(...)`.
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
      setTabs(await window.api.browser.listTabs());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await window.api.browser.queryHistory({ limit: 200 }));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshBookmarks = useCallback(async () => {
    try {
      setBookmarks(await window.api.browser.listBookmarks());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshDownloads = useCallback(async () => {
    try {
      setDownloads(await window.api.browser.listDownloads());
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
// Action helpers — thin wrappers around window.api.browser for ergonomics.
// ---------------------------------------------------------------------------
export function useBrowserActions() {
  return {
    openTab: (req: OpenTabRequest) => window.api.browser.openTab(req),
    closeTab: (tabId: string) => window.api.browser.closeTab(tabId),
    activateTab: (tabId: string) => window.api.browser.activateTab(tabId),
    navigate: (tabId: string, url: string) =>
      window.api.browser.navigate({ tabId, url }),
    back: (tabId: string) => window.api.browser.back(tabId),
    forward: (tabId: string) => window.api.browser.forward(tabId),
    reload: (tabId: string) => window.api.browser.reload(tabId),
    stop: (tabId: string) => window.api.browser.stop(tabId),
    addBookmark: (url: string, title: string) =>
      window.api.browser.addBookmark({ url, title }),
    deleteBookmark: (id: string) => window.api.browser.deleteBookmark(id),
    deleteHistory: (id: string) => window.api.browser.deleteHistory(id),
    clearHistory: () => window.api.browser.clearHistory(),
    cancelDownload: (id: string) => window.api.browser.cancelDownload(id),
    removeDownload: (id: string) => window.api.browser.removeDownload(id),
  };
}
