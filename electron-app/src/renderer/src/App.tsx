import { useState, useEffect, useCallback } from 'react';
import { useBrowserUi, useBrowserActions } from './store/browser-store';
import { useAgentStore } from './store/agent-store';
import { TopBar } from './components/TopBar';
import { AgentPanel } from './components/AgentPanel';
import { HistoryPanel } from './components/panels/HistoryPanel';
import { BookmarksPanel } from './components/panels/BookmarksPanel';
import { DownloadsPanel } from './components/panels/DownloadsPanel';
import { VaultPanel } from './components/panels/VaultPanel';
import { pickLayoutKind, getLayoutModifier, type PanelKind } from './store/ui-logic';

export function App() {
  const ui = useBrowserUi();
  const actions = useBrowserActions();
  const agent = useAgentStore();
  const [activePanel, setActivePanel] = useState<PanelKind | null>(null);
  const [version, setVersion] = useState<string>('—');
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );

  // Track window width for responsive layout.
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Read app version once for the chrome footer.
  useEffect(() => {
    let cancelled = false;
    window.api
      .getVersion()
      .then((v) => {
        if (!cancelled) setVersion(`Electron ${v.electron} · Chromium ${v.chrome}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTab = ui.tabs.find((t) => t.isActive) ?? null;
  const layoutKind = pickLayoutKind(windowWidth);
  const layoutMod = getLayoutModifier(layoutKind);
  const showAgentPanel = layoutKind !== 'narrow';

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

  const handleTogglePanel = useCallback((kind: PanelKind) => {
    setActivePanel((prev) => (prev === kind ? null : kind));
  }, []);

  const handleSetControlMode = useCallback(
    (mode: 'HUMAN' | 'AGENT') => {
      void agent.setMode(mode);
    },
    [agent]
  );

  const handleTakeControl = useCallback(() => {
    void agent.takeControl('user_request');
  }, [agent]);

  const handleAgentRun = useCallback(
    (command: string) => {
      void agent.run(command);
    },
    [agent]
  );

  const handleAgentStop = useCallback(() => {
    void agent.stop('user_request');
  }, [agent]);

  const agentRunning =
    agent.status?.state === 'RUNNING' || agent.status?.state === 'STOPPING';

  return (
    <div className={`app ${layoutMod}`}>
      <TopBar
        tabs={ui.tabs}
        activeTabId={ui.activeTabId}
        activeTab={activeTab}
        activePanel={activePanel ?? 'history'}
        historyCount={ui.history.length}
        bookmarksCount={ui.bookmarks.length}
        downloadsCount={ui.downloads.length}
        controlMode={agent.controlMode}
        agentRunning={agentRunning}
        onOpenTab={handleOpenTab}
        onCloseTab={handleCloseTab}
        onActivateTab={handleActivateTab}
        onNavigate={handleNavigate}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onStop={handleStop}
        onAddBookmark={handleAddBookmark}
        onTogglePanel={handleTogglePanel}
        onSetControlMode={handleSetControlMode}
        onTakeControl={handleTakeControl}
      />

      {showAgentPanel && (
        <AgentPanel
          mode={agent.controlMode}
          agentRunning={agentRunning}
          agentStatus={agent.status}
          timeline={agent.timeline}
          onRun={handleAgentRun}
          onStop={handleAgentStop}
          onTakeControl={handleTakeControl}
        />
      )}

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
      <VaultPanel
        open={activePanel === 'vault'}
        onClose={() => setActivePanel(null)}
        activeTabId={ui.activeTabId}
      />

      <footer className="app__footer" role="contentinfo">
        <span className="app__footer-brand">PERSONAL AGENTIC BROWSER</span>
        <span className="app__footer-version">{version}</span>
        <span className="app__footer-tabs">
          {ui.tabs.length} {ui.tabs.length === 1 ? 'tab' : 'tabs'}
        </span>
      </footer>
    </div>
  );
}
