import { platformApi } from './platform';
import { nativeErrorCode, nativeErrorMessage } from '@shared/native-errors';
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
import { useI18n } from './i18n';
import type { WebAppPin } from '@shared/browser-types';
import { PAB_NEW_TAB_URL } from '@shared/browser-types';
import type { RuntimeStatus } from '@shared/ipc-types';

export function App() {
  const { t, lang } = useI18n();
  const ui = useBrowserUi();
  const actions = useBrowserActions();
  const agent = useAgentStore();
  const [activePanel, setActivePanel] = useState<PanelKind | null>(null);
  const [agentPanelOpen, setAgentPanelOpen] = useState(true);
  const [storageError, setStorageError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const reportActionError = useCallback((e: unknown) => setActionError(nativeErrorCode(e)), []);
  useEffect(() => platformApi.on('storage:error', () => setStorageError(true)), []);
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
          setVersion(`${v.electron} · WebView2 ${v.chrome}`);
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
  const showAgentPanel = layoutKind !== 'narrow' && agentPanelOpen;

  // Native tab webviews sit above the React shell. Keep their right edge in
  // lockstep with the visible agent rail so closing the panel releases the
  // space instead of leaving a black strip.
  useEffect(() => {
    void platformApi.window.setAgentPanelOpen?.(showAgentPanel);
  }, [showAgentPanel]);

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
      if (mode === 'AGENT') setAgentPanelOpen(true);
      void agent.setMode(mode).catch(reportActionError);
    },
    [agent, reportActionError]
  );

  const handleToggleAgentPanel = useCallback(() => {
    setAgentPanelOpen((open) => !open);
  }, []);

  const handleTakeControl = useCallback(() => {
    void agent.takeControl('user_request').catch(reportActionError);
  }, [agent, reportActionError]);

  const handleAgentRun = useCallback(
    (command: string, opts?: { attachmentIds?: string[] }) => {
      setActionError(null);
      void agent.run(command, opts).then(r => { if (r.state === 'FAILED') reportActionError(r.error ?? r.reason); }).catch(reportActionError).finally(() => { for (const id of opts?.attachmentIds ?? []) void platformApi.agent.releaseAttachment?.(id).catch(() => {}); });
    },
    [agent, reportActionError]
  );

  const handleAgentResearch = useCallback(
    (query: string, opts?: { attachmentIds?: string[] }) => {
      setActionError(null);
      void agent.runResearch(query, opts).then(r => { if (r.state === 'FAILED') reportActionError(r.error ?? r.reason); }).catch(reportActionError).finally(() => { for (const id of opts?.attachmentIds ?? []) void platformApi.agent.releaseAttachment?.(id).catch(() => {}); });
    },
    [agent, reportActionError]
  );

  const handleAgentStop = useCallback(() => {
    void agent.stop('user_request').catch(reportActionError);
  }, [agent, reportActionError]);

  // Titlebar quick actions — each maps to a REAL, unique capability.
  // De-dup: the old AUTOMATE duplicated THINK's mode switch and the toolbar
  // AGENT button; SETTINGS duplicated BUILD's vault panel — both removed.
  const handleNavAction = useCallback(
    (action: 'think' | 'research' | 'build') => {
      if (action === 'think') {
        setAgentPanelOpen(true);
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('pab:focus-agent-input'));
        });
        if (agent.controlMode !== 'AGENT') void agent.setMode('AGENT');
      } else if (action === 'research') {
        void handleOpenUrl('pab://search');
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
        agentPanelOpen={showAgentPanel}
        onToggleAgentPanel={handleToggleAgentPanel}
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
          onClose={() => setAgentPanelOpen(false)}
        />
      )}

      <PasswordPrompt />
      <MemoryPrompt />

      {storageError && <div role="alert" className="browser-error">{t('storage.error')}</div>}
      {actionError && <div role="alert" className="app__error">{nativeErrorMessage(actionError, lang)}</div>}
      {ui.error && (
        <div className="app__error" role="alert">
          {nativeErrorMessage(ui.error, lang)}
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
                ? t('app.runtimeOkTip', { endpoint: runtime.endpoint })
                : t('app.runtimeDownTip', { endpoint: runtime?.endpoint ?? '127.0.0.1:3000' })
            }
          >
            <span className="app__footer-dot" aria-hidden />
            {runtime?.endpoint?.replace(/^https?:\/\//, '') ?? '127.0.0.1:3000'}
          </span>
          <span className="app__footer-sep">|</span>
          <span className="app__footer-state">
            {runtime?.reachable
              ? t('app.runtimeOk')
              : runtime?.state === 'starting'
                ? t('app.runtimeStarting')
                : t('app.runtimeOffline')}
          </span>
        </div>
      </footer>
    </div>
  );
}
