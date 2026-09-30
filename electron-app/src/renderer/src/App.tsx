import { platformApi } from './platform';
import { useState, useEffect, useCallback } from 'react';
import { useBrowserUi, useBrowserActions } from './store/browser-store';
import { useAgentStore } from './store/agent-store';
import { TopBar } from './components/TopBar';
import { AgentPanel } from './components/AgentPanel';
import { PasswordPrompt } from './components/PasswordPrompt';
import { MemoryPrompt } from './components/MemoryPrompt';
import { HistoryPanel } from './components/panels/HistoryPanel';
import { BookmarksPanel } from './components/panels/BookmarksPanel';
import { DownloadsPanel } from './components/panels/DownloadsPanel';
import { VaultPanel } from './components/panels/VaultPanel';
import { pickLayoutKind, getLayoutModifier, findWebAppTabId, type PanelKind } from './store/ui-logic';
import type { WebAppPin } from '@shared/browser-types';
import { PAB_NEW_TAB_URL } from '@shared/browser-types';
import type { RuntimeStatus } from '@shared/ipc-types';

export function App() {
  const ui = useBrowserUi();
  const actions = useBrowserActions();
  const agent = useAgentStore();
  const [activePanel, setActivePanel] = useState<PanelKind | null>(null);
  const [version, setVersion] = useState<string>('—');
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
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
    platformApi
      .getVersion()
      .then((v) => {
        if (!cancelled) {
          setVersion(`Electron ${v.electron} · Chromium ${v.chrome}`);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Managed-runtime health for the footer (polled — main caches 20s).
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      platformApi
        .runtimeStatus()
        .then((s) => {
          if (!cancelled) setRuntime(s);
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Live network state for the titlebar ONLINE pill.
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const activeTab = ui.tabs.find((t) => t.isActive) ?? null;
  const layoutKind = pickLayoutKind(windowWidth);
  const layoutMod = getLayoutModifier(layoutKind);
  const showAgentPanel = layoutKind !== 'narrow';

  const handleOpenTab = useCallback(async () => {
    await actions.openTab({ url: PAB_NEW_TAB_URL, activate: true });
    await ui.refreshTabs();
  }, [actions, ui]);

  // Pinned web apps (WhatsApp / Telegram): focus the existing app tab, or
  // open one. The pin itself stays in the strip — tabs come and go.
  const handleOpenWebApp = useCallback(
    async (app: WebAppPin) => {
      const existing = findWebAppTabId(ui.tabs, app);
      if (existing) {
        await actions.activateTab(existing);
      } else {
        await actions.openTab({ url: app.url, activate: true });
      }
      await ui.refreshTabs();
    },
    [actions, ui]
  );

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      await actions.closeTab(tabId);
      // Matrix concept: closing the LAST tab never leaves an empty window —
      // a fresh search dashboard (pab://newtab) takes its place.
      if (ui.tabs.length <= 1) {
        await actions.openTab({ url: PAB_NEW_TAB_URL, activate: true });
      }
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
    (command: string, opts?: { attachmentIds?: string[] }) => {
      void agent.run(command, opts);
    },
    [agent]
  );

  const handleAgentResearch = useCallback(
    (query: string) => {
      void agent.runResearch(query);
    },
    [agent]
  );

  const handleAgentStop = useCallback(() => {
    void agent.stop('user_request');
  }, [agent]);

  // Titlebar quick actions — each maps to a REAL capability.
  const handleNavAction = useCallback(
    (action: 'think' | 'research' | 'build' | 'automate' | 'settings') => {
      if (action === 'think') {
        window.dispatchEvent(new CustomEvent('pab:focus-agent-input'));
        if (agent.controlMode !== 'AGENT') void agent.setMode('AGENT');
      } else if (action === 'research') {
        void handleOpenUrl('pab://search');
      } else if (action === 'build') {
        setActivePanel((prev) => (prev === 'vault' ? null : 'vault'));
      } else if (action === 'automate') {
        void agent.setMode('AGENT');
      } else {
        setActivePanel((prev) => (prev === 'vault' ? null : 'vault'));
      }
    },
    [agent, handleOpenUrl]
  );

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
        online={online}
        onOpenTab={handleOpenTab}
        onOpenWebApp={handleOpenWebApp}
        onCloseTab={handleCloseTab}
        onActivateTab={handleActivateTab}
        onNavigate={handleNavigate}
        onOpenUrl={handleOpenUrl}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onStop={handleStop}
        onAddBookmark={handleAddBookmark}
        onTogglePanel={handleTogglePanel}
        onSetControlMode={handleSetControlMode}
        onTakeControl={handleTakeControl}
        onNavAction={handleNavAction}
      />

      {showAgentPanel && (
        <AgentPanel
          mode={agent.controlMode}
          agentRunning={agentRunning}
          agentStatus={agent.status}
          timeline={agent.timeline}
          onRun={handleAgentRun}
          onResearch={handleAgentResearch}
          researchReport={agent.researchReport}
          researchActive={agent.researchMode}
          onStop={handleAgentStop}
          onTakeControl={handleTakeControl}
          chat={agent.chat}
          onClearChat={agent.clearChat}
        />
      )}

      <PasswordPrompt />
      <MemoryPrompt />

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
        <div className="app__footer-left">
          <span className="app__footer-brand">HayDev Browser OS v0.1.0</span>
          <span className="app__footer-sep">|</span>
          <span className="app__footer-version">{version}</span>
          <span className="app__footer-sep">|</span>
          <span className="app__footer-lab">HayDev Labs</span>
        </div>
        <div className="app__footer-right">
          <span
            className={`app__footer-runtime ${runtime?.reachable ? 'app__footer-runtime--ok' : 'app__footer-runtime--down'}`}
            title={
              runtime?.reachable
                ? `Managed search runtime is reachable at ${runtime.endpoint}`
                : `Search runtime not responding at ${runtime?.endpoint ?? '127.0.0.1:3000'}`
            }
          >
            <span className="app__footer-dot" aria-hidden />
            {runtime?.endpoint?.replace(/^https?:\/\//, '') ?? '127.0.0.1:3000'}
          </span>
          <span className="app__footer-sep">|</span>
          <span className="app__footer-state">
            {runtime?.reachable
              ? 'All Systems Operational'
              : runtime?.state === 'starting'
                ? 'Search Runtime Starting…'
                : 'Search Runtime Offline'}
          </span>
        </div>
      </footer>
    </div>
  );
}
