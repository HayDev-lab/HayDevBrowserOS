/**
 * Electron MAIN process — Personal Agentic Browser (Foundation + Browser Core).
 *
 * Scope of this file:
 *  - app lifecycle (single-instance lock, ready, window-creation, quit)
 *  - BrowserWindow (BaseWindow-style) with the mandated security baseline
 *  - construction of `BrowserCore` and attachment to the window
 *  - registration of the typed IPC handlers
 *  - minimal error handling (uncaughtException, unhandledRejection,
 *    render-process-gone, child-process-gone)
 *
 * PROMPT 2 changes:
 *  - The renderer chrome is now hosted in a WebContentsView (added by
 *    BrowserCore), not loaded into the BrowserWindow's own webContents.
 *  - BrowserCore owns tab WebContentsView instances.
 *  - Window-open policy is delegated to BrowserCore (which uses setWindowOpenHandler
 *    on each tab view to keep external navigations in the user's default browser).
 *
 * NON-GOALS for this stage:
 *  - AI / Ollama / MCP / Vault / Incognito UI / Deep Research
 */
import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc-handlers';
import { BrowserCore } from './browser/runtime/browser-core';
import { BrowserActionService } from './browser/actions/runtime/browser-action-service';
import { OllamaClient } from './browser/agent/runtime/ollama-client';
import { AgentController } from './browser/agent/runtime/agent-controller';
import {
  registerAgentIpcHandlers,
  makeControllerCallbacks,
} from './agent-ipc-handlers';

// ---------------------------------------------------------------------------
// Error handling (minimal, no log files yet — PROMPT 1 keeps surface small)
// ---------------------------------------------------------------------------
function installErrorHandlers(): void {
  process.on('uncaughtException', (err: Error) => {
    // We deliberately do not swallow; print to stderr so Electron's logs capture it.
    // Future stages will route this into a structured logger.
    console.error('[main] uncaughtException:', err);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    console.error('[main] unhandledRejection:', reason);
  });
}

// ---------------------------------------------------------------------------
// Single instance lock — required so a second launch focuses the existing window.
// ---------------------------------------------------------------------------
function acquireSingleInstanceLock(): boolean {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    // Focus the first window if a second instance tries to launch.
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const [first] = windows;
      if (first.isMinimized()) first.restore();
      first.focus();
    }
  });
  return true;
}

// ---------------------------------------------------------------------------
// BrowserWindow factory — SECURITY BASELINE for remote web content.
// ---------------------------------------------------------------------------
let browserCore: BrowserCore | null = null;
let browserActionService: BrowserActionService | null = null;
let agentController: AgentController | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#05070d', // Neural Cockpit dark foundation (PROMPT 3 placeholder)
    show: false,
    title: 'Personal Agentic Browser',
    autoHideMenuBar: true,
    webPreferences: {
      // The BrowserWindow's own webContents is NOT used for browsing —
      // BrowserCore installs a WebContentsView for the renderer chrome.
      // We still apply the security baseline for defence in depth.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Default external-link policy for the BrowserWindow's own webContents
  // (which renders the React chrome). Tab web contents views get their
  // own per-tab policy in NavigationController / BrowserCore.
  win.webContents.setWindowOpenHandler(({ url }) => {
    setImmediate(() => {
      void shell.openExternal(url);
    });
    return { action: 'deny' };
  });

  // Construct BrowserCore and attach to the window.
  const userDataDir = app.getPath('userData');
  const rendererHtmlPath =
    typeof RENDERER_VITE_ENTRY === 'string'
      ? RENDERER_VITE_ENTRY
      : path.join(__dirname, '../renderer/index.html');
  const rendererDevUrl =
    typeof MAIN_VITE_ENTRY === 'string' ? MAIN_VITE_ENTRY : undefined;

  browserCore = new BrowserCore({
    userDataDir,
    rendererHtmlPath,
    rendererDevUrl,
  });
  browserCore.attachToWindow(win);

  // Construct the BrowserActionService over the existing BrowserCore.
  // The service is the ONLY browser execution layer for the agent.
  browserActionService = new BrowserActionService({
    tabManagement: {
      listTabs: () => browserCore!.listTabs(),
      openTab: (opts) => browserCore!.openTab(opts),
      activateTab: (tabId) => browserCore!.activateTab(tabId),
      closeTab: (tabId) => browserCore!.closeTab(tabId),
      hasTab: (tabId) => browserCore!.listTabs().some((t) => t.id === tabId),
    },
    // Resolve a tab id to its WebContents — BrowserCore owns the per-tab
    // WebContentsView; we need a way to access the underlying webContents.
    // For V1, we expose a method on BrowserCore (added in PROMPT 2 but
    // accessed via a thin shim here). If BrowserCore doesn't expose it,
    // we return null and DOM-level actions will fail with tab_not_found
    // (which is the safe default).
    resolveWebContents: (tabId) => {
      // BrowserCore doesn't expose webContents directly in V1 — this is a
      // known limitation. The BrowserActionService falls back to
      // navigate/listTabs/openTab/activateTab/closeTab which don't need
      // WebContents. DOM actions (click/type/scroll/readPage) require
      // WebContents and will be DEFERRED_RUNTIME until BrowserCore exposes
      // a resolveWebContents method.
      // TODO(PROMPT 11): add BrowserCore.getTabWebContents(tabId).
      void tabId;
      return null;
    },
  });

  // Construct the OllamaClient from environment configuration.
  // The API key is read at call time from process.env.OLLAMA_API_KEY.
  // If absent, isConfigured() returns false and agent.run() returns
  // AI_PROVIDER_NOT_CONFIGURED (honest UI — no fake responses).
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_MODEL ?? 'llama3.1';
  const ollama = new OllamaClient({
    baseUrl: ollamaBaseUrl,
    model: ollamaModel,
    apiKeyEnvVar: 'OLLAMA_API_KEY',
  });

  // Construct the AgentController over the OllamaClient + BrowserActionService.
  agentController = new AgentController({
    ollama,
    actions: browserActionService,
    callbacks: makeControllerCallbacks(),
  });

  return win;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
function bootstrap(): void {
  installErrorHandlers();

  if (!acquireSingleInstanceLock()) {
    return; // app.quit() already invoked.
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.whenReady().then(() => {
    // Construct the window + BrowserCore first. BrowserCore is required
    // for the browser-channel handlers; foundation handlers can also be
    // registered at the same time. Registering ONCE avoids "duplicate
    // handler" errors from Electron.
    createMainWindow(); // constructs BrowserCore + BrowserActionService + AgentController
    registerIpcHandlers(browserCore ?? undefined);
    if (agentController) {
      registerAgentIpcHandlers(agentController);
    }
  });

  app.on('render-process-gone', (_evt, _wc, details) => {
    console.error('[main] render-process-gone:', details);
  });

  app.on('child-process-gone', (_evt, details) => {
    console.error('[main] child-process-gone:', details);
  });

  // On quit, ensure incognito partitions are cleared + agent is disposed.
  app.on('before-quit', () => {
    if (agentController) {
      agentController.dispose();
    }
    if (browserActionService) {
      browserActionService.dispose();
    }
    if (browserCore) {
      void browserCore.dispose();
    }
  });
}

bootstrap();
