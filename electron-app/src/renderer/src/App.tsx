import { useState, useEffect, useCallback } from 'react';
import { useBrowserUi, useBrowserActions } from './store/browser-store';
import { TabStrip } from './components/TabStrip';
import { AddressBar } from './components/AddressBar';
import { HistoryPanel } from './components/panels/HistoryPanel';
import { BookmarksPanel } from './components/panels/BookmarksPanel';
import { DownloadsPanel } from './components/panels/DownloadsPanel';

type PanelKind = 'history' | 'bookmarks' | 'downloads' | null;

export function App() {
  const ui = useBrowserUi();
  const actions = useBrowserActions();
  const [activePanel, setActivePanel] = useState<PanelKind>(null);
  const [version, setVersion] = useState<string>('—');

  // Read app version once for the chrome footer.
  useEffect(() => {
    let cancelled = false;
    window.api
      .getVersion()
      .then((v) => {
        if (!cancelled) setVersion(`${v.electron} / chromium ${v.chrome}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTab = ui.tabs.find((t) => t.isActive) ?? null;

  const handleOpenTab = useCallback(async () => {
    await actions.openTab({ url: 'about:blank', activate: true });
    await ui.refreshTabs();
  }, [actions, ui]);

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      await actions.closeTab(tabId);
      await ui.refreshTabs();
    },
    [actions, ui]
  );

  const handleActivateTab = useCallback(
    async (tabId: string) => {
      await actions.activateTab(tabId);
      await ui.refreshTabs();
    },
    [actions, ui]
  );

  const handleNavigate = useCallback(
    async (tabId: string, url: string) => {
      await actions.navigate(tabId, url);
      await ui.refreshTabs();
    },
    [actions, ui]
  );

  const handleBack = useCallback(
    async (tabId: string) => {
      await actions.back(tabId);
      await ui.refreshTabs();
    },
    [actions, ui]
  );

  const handleForward = useCallback(
    async (tabId: string) => {
      await actions.forward(tabId);
      await ui.refreshTabs();
    },
    [actions, ui]
  );

  const handleReload = useCallback(
    async (tabId: string) => {
      await actions.reload(tabId);
      await ui.refreshTabs();
    },
    [actions, ui]
  );

  const handleStop = useCallback(
    async (tabId: string) => {
      await actions.stop(tabId);
      await ui.refreshTabs();
    },
    [actions, ui]
  );

  const handleOpenUrl = useCallback(
    async (url: string) => {
      if (!activeTab) {
        await actions.openTab({ url, activate: true });
      } else {
        await actions.navigate(activeTab.id, url);
      }
      await ui.refreshTabs();
      setActivePanel(null);
    },
    [actions, activeTab, ui]
  );

  const handleAddBookmark = useCallback(async () => {
    if (!activeTab?.url) return;
    await actions.addBookmark(activeTab.url, activeTab.title || activeTab.url);
    await ui.refreshBookmarks();
  }, [actions, activeTab, ui]);

  const handleDeleteBookmark = useCallback(
    async (id: string) => {
      await actions.deleteBookmark(id);
      await ui.refreshBookmarks();
    },
    [actions, ui]
  );

  const handleDeleteHistory = useCallback(
    async (id: string) => {
      await actions.deleteHistory(id);
      await ui.refreshHistory();
    },
    [actions, ui]
  );

  const handleClearHistory = useCallback(async () => {
    await actions.clearHistory();
    await ui.refreshHistory();
  }, [actions, ui]);

  const handleCancelDownload = useCallback(
    async (id: string) => {
      await actions.cancelDownload(id);
      await ui.refreshDownloads();
    },
    [actions, ui]
  );

  const handleRemoveDownload = useCallback(
    async (id: string) => {
      await actions.removeDownload(id);
      await ui.refreshDownloads();
    },
    [actions, ui]
  );

  return (
    <div className="app">
      <TabStrip
        tabs={ui.tabs}
        activeTabId={ui.activeTabId}
        onOpenTab={handleOpenTab}
        onCloseTab={handleCloseTab}
        onActivateTab={handleActivateTab}
      />
      <div className="toolbar">
        <AddressBar
          tab={activeTab}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onForward={handleForward}
          onReload={handleReload}
          onStop={handleStop}
        />
        <div className="toolbar__actions">
          <button
            className="toolbar__btn"
            onClick={handleAddBookmark}
            disabled={!activeTab?.url}
            title="Bookmark this page"
          >
            ★
          </button>
          <button
            className={`toolbar__btn ${activePanel === 'history' ? 'toolbar__btn--active' : ''}`}
            onClick={() =>
              setActivePanel(activePanel === 'history' ? null : 'history')
            }
            title="History"
          >
            History
          </button>
          <button
            className={`toolbar__btn ${activePanel === 'bookmarks' ? 'toolbar__btn--active' : ''}`}
            onClick={() =>
              setActivePanel(activePanel === 'bookmarks' ? null : 'bookmarks')
            }
            title="Bookmarks"
          >
            Bookmarks
          </button>
          <button
            className={`toolbar__btn ${activePanel === 'downloads' ? 'toolbar__btn--active' : ''}`}
            onClick={() =>
              setActivePanel(activePanel === 'downloads' ? null : 'downloads')
            }
            title="Downloads"
          >
            Downloads
          </button>
        </div>
      </div>
      {ui.error && (
        <div className="app__error" role="alert">
          {ui.error}
        </div>
      )}
      <HistoryPanel
        open={activePanel === 'history'}
        history={ui.history}
        onClose={() => setActivePanel(null)}
        onDelete={handleDeleteHistory}
        onClear={handleClearHistory}
        onOpenUrl={handleOpenUrl}
      />
      <BookmarksPanel
        open={activePanel === 'bookmarks'}
        bookmarks={ui.bookmarks}
        onClose={() => setActivePanel(null)}
        onDelete={handleDeleteBookmark}
        onOpenUrl={handleOpenUrl}
      />
      <DownloadsPanel
        open={activePanel === 'downloads'}
        downloads={ui.downloads}
        onClose={() => setActivePanel(null)}
        onCancel={handleCancelDownload}
        onRemove={handleRemoveDownload}
      />
      <div className="app__footer">
        <span>Personal Agentic Browser · {version}</span>
        <span>{ui.tabs.length} tab{ui.tabs.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}
