/**
 * Electron MAIN process — HayDev Browser OS (Foundation + Browser Core).
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
// Load environment variables from .env BEFORE any code that reads process.env.
// This is required because Electron's main process does not auto-load .env files.
// NOTE: In the Vite-built bundle, __dirname resolves to .vite/build/, so we
// traverse up TWO levels to reach the electron-app/ root where .env lives.
// In production, the .env is NOT bundled (asar) — the API key is expected to be
// provided as a real environment variable. dotenv.config is therefore best-effort
// and must never crash startup if the file is absent.
import dotenv from 'dotenv';
import { fileURLToPath as _fileURLToPath } from 'node:url';
const _dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : require('node:path').dirname(_fileURLToPath(import.meta.url));
try {
  dotenv.config({ path: require('node:path').resolve(_dirname, '..', '..', '.env') });
} catch {
  // .env is optional in production; real env vars take precedence.
}

import { app, BrowserWindow, shell, protocol, ipcMain } from 'electron';
import path from 'node:path';
import { registerIpcHandlers, setRuntimeEndpointProvider } from './ipc-handlers';
import { BrowserCore } from './browser/runtime/browser-core';
import { SessionManager } from './browser/runtime/session-manager';
import { BrowserActionService } from './browser/actions/runtime/browser-action-service';
import { OllamaClient } from './browser/agent/runtime/ollama-client';
import { GeminiClient } from './browser/agent/runtime/gemini-client';
import type { OllamaClientPort } from '@shared/agent-types';
import { AgentController } from './browser/agent/runtime/agent-controller';
import { AgentOverlay } from './browser/agent/runtime/agent-overlay';
import { computeTopSites, buildNewTabHtml } from './browser/pure/newtab-page';
import { fetchTechNews } from './browser/pure/tech-news';
import { buildSearchPageHtml } from './browser/pure/search-page';
import { buildSelectionPrompt } from './browser/agent/pure/selection-actions';
import { MemoryStore } from './browser/agent/pure/memory-store';
import { fileStorageFor } from './browser/storage/file-storage-adapter';
import {
  registerAgentIpcHandlers,
  makeControllerCallbacks,
  registerPushTarget,
} from './agent-ipc-handlers';
import { SafeStorageEncryptionAdapter } from './browser/vault/runtime/encryption-adapter';
import { fileVaultStorageFor } from './browser/vault/runtime/vault-storage-adapter';
import { CredentialVault } from './browser/vault/runtime/credential-vault';
import { registerVaultIpcHandlers } from './vault-ipc-handlers';
import { registerNewTabIpcHandlers } from './newtab-ipc-handlers';
import { PasswordCaptureService } from './browser/vault/pure/password-capture';
import { broadcastPushEvent } from './agent-ipc-handlers';
import { McpOwnershipGuard, isAgentStateActive } from './browser/mcp/pure/mcp-ownership';
import { McpToolHandler } from './browser/mcp/runtime/mcp-tool-handler';
import { McpServerRuntime } from './browser/mcp/runtime/mcp-server';
import { DarkWebService } from './browser/darkweb/runtime/darkweb-service';
import { handleDarkWebPabRequest } from './browser/darkweb/runtime/darkweb-pab-api';
import {
  DarkWebDownloadManager,
  prepareQuarantineDir,
} from './browser/darkweb/electron/download-quarantine';
import { HayDevRuntimeManager } from './browser/runtime/engine/runtime/haydev-runtime-manager';
import { resolvePreferredChatModel } from './browser/runtime/engine/runtime/search-services';
import type { McpBrowserPort } from '@shared/mcp-types';
import type { ActionResult, ActionInput } from '@shared/browser-actions-types';

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
let credentialVault: CredentialVault | null = null;
let mcpOwnershipGuard: McpOwnershipGuard | null = null;
let mcpServer: McpServerRuntime | null = null;
let darkWebService: DarkWebService | null = null;
let darkWebDownloads: DarkWebDownloadManager | null = null;
let runtimeManager: HayDevRuntimeManager | null = null;
/** Standalone manager for dark-web partitions (SessionManager is per-core). */
const darkWebSessionManager = new SessionManager();

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    // Frameless — the Matrix chrome renders its own title bar with window
    // controls (window:minimize / window:toggleMaximize / window:close IPC).
    frame: false,
    backgroundColor: '#02040a', // matches --nc-bg design token (Neural Cockpit deep-space foundation)
    show: false,
    title: 'HayDev Browser OS',
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

  win.webContents.on('did-finish-load', () => {
    win.show();
    win.focus();
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[main] did-fail-load:', errorCode, errorDescription);
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
  // In dev, @electron-forge/plugin-vite injects MAIN_WINDOW_VITE_DEV_SERVER_URL
  // (the constant name is derived from the renderer config `name` field in
  // forge.config.ts — `main_window`). In the packaged build, that global is
  // undefined, so we load the bundled renderer file instead.
  //
  // The renderer is emitted by vite.renderer.config.ts to
  // `.vite/build/renderer/index.html`, which is the SAME directory as
  // `main.js` (`.vite/build/`). The previous fallback used
  // `path.join(__dirname, '../renderer/index.html')` which resolved to
  // `.vite/renderer/index.html` — a path that does NOT exist in the
  // packaged app (the `build/` segment was missing). The correct relative
  // path is `./renderer/index.html`.
  const rendererHtmlPath = path.join(__dirname, 'renderer/index.html');
  const rendererDevUrl =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' && MAIN_WINDOW_VITE_DEV_SERVER_URL.length > 0
      ? MAIN_WINDOW_VITE_DEV_SERVER_URL
      : undefined;

  // Dark Web Search subsystem (Tor gateway + providers + crawler + index).
  // Constructed before BrowserCore so the dark-web session factory exists
  // before any tab can request it. Its storages are JSON files under
  // userData/darkweb/ — same atomic FileStorageAdapter as history/bookmarks.
  darkWebService = new DarkWebService({
    userDataDir,
    configStorage: fileStorageFor(userDataDir, 'darkweb-config.json'),
    indexStorage: fileStorageFor(userDataDir, 'darkweb-index.json'),
    historyStorage: fileStorageFor(userDataDir, 'darkweb-history.json'),
  });
  void darkWebService.loadConfig();
  darkWebDownloads = new DarkWebDownloadManager(userDataDir);
  void prepareQuarantineDir(userDataDir);

  // Unified runtime manager — Perplexica / SearXNG / Tor as INTERNAL
  // managed engines (spec §2/§8). External healthy endpoints from env are
  // adopted (dev zero-change); otherwise bundled/dev managed runtimes are
  // spawned on dynamic loopback ports. Docker is NEVER consulted.
  runtimeManager = new HayDevRuntimeManager({
    userDataDir,
    resourcesPath: app.isPackaged ? process.resourcesPath : null,
    perplexicaDevDir: process.env.PAB_PERPLEXICA_DIR?.trim() || null,
    perplexicaExternalUrl: process.env.PAB_PERPLEXICA_URL?.trim() || null,
    searxngExternalUrl: process.env.PAB_SEARXNG_URL?.trim()
      || (!app.isPackaged ? 'http://127.0.0.1:8888' : null), // dev docker convenience only
    torMode: (process.env.PAB_TOR_MODE?.trim() === 'external' ? 'external' : 'managed'),
    torSocksPort: Number.parseInt(process.env.PAB_TOR_SOCKS_PORT ?? '', 10) || 9050,
  });

  browserCore = new BrowserCore({
    userDataDir,
    rendererHtmlPath,
    rendererDevUrl,
    // Selection context-menu actions run through the SAME agent pipeline.
    // agentController is constructed later in this function — the closure
    // reads it lazily at click time. The run refuses in HUMAN mode
    // (visible in the rail timeline).
    onSelectionAction: ({ action, text }) => {
      if (!agentController) return;
      void agentController.run({ command: buildSelectionPrompt(action, text) });
    },
    onSessionCreated: (session) => {
      try {
        session.protocol.handle('pab', handlePabRequest);
      } catch {
        // Already handled on this session — fine.
      }
    },
    darkWebAllowed: () => darkWebService?.getConfig().enabled === true,
    // Fresh ephemeral partition + fixed Tor SOCKS proxy (loopback forced
    // through it) + denied permissions + quarantined downloads. The proxy
    // is configured synchronously; if Tor is offline, onion navigations
    // FAIL (fail-closed) — never a clearnet fallback.
    getDarkWebSession: () => {
      if (!darkWebService || !darkWebService.getConfig().enabled) return null;
      const ses = darkWebSessionManager.forDarkWeb();
      const tor = darkWebService.getConfig().tor;
      darkWebSessionManager.configureDarkWebSession(ses, tor.socksHost, tor.socksPort);
      darkWebDownloads?.attach(ses);
      return ses;
    },
  });
  browserCore.attachToWindow(win);
  // The chrome renderer is a WebContentsView — register it so push events
  // (agent timeline / state / control mode) reach the UI.
  registerPushTarget(browserCore.getRendererWebContents());

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
    // Resolve a tab id to its underlying WebContents via BrowserCore's
    // internal accessor. The returned WebContents is a LIVE Electron object
    // that NEVER crosses the IPC boundary — it is consumed only by
    // WebContentsActionAdapter (trusted main-process code) which uses
    // executeJavaScript with internally-generated static script templates.
    resolveWebContents: (tabId) => browserCore!.resolveWebContents(tabId),
  });

  // Construct the LLM provider from environment configuration.
  // Selection: AI_PROVIDER=gemini|nvidia|ollama explicitly, else AUTO —
  // Gemini when GEMINI_API_KEY is present, then NVIDIA NIM, then the legacy
  // Ollama cloud/local stack. Keys are read at CALL time from the
  // environment; absent key → isConfigured() false → honest
  // AI_PROVIDER_NOT_CONFIGURED (no fake responses).
  const aiProvider = process.env.AI_PROVIDER?.trim().toLowerCase()
    || (process.env.GEMINI_API_KEY?.trim() ? 'gemini'
      : process.env.NVIDIA_API_KEY?.trim() ? 'nvidia'
        : 'ollama');
  let ollama: OllamaClientPort;
  if (aiProvider === 'gemini') {
    // Cheap-but-strong default: Gemini Flash Lite line (GEMINI_MODEL).
    ollama = new GeminiClient({});
  } else if (aiProvider === 'nvidia') {
    // NVIDIA NIM — OpenAI-compatible (integrate.api.nvidia.com/v1).
    ollama = new GeminiClient({
      baseUrl: process.env.NVIDIA_BASE_URL?.trim() || 'https://integrate.api.nvidia.com/v1',
      credentialEnvVar: 'NVIDIA_API_KEY',
      model: process.env.NVIDIA_MODEL?.trim() || 'openai/gpt-oss-20b',
    });
  } else {
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    const ollamaModel = process.env.OLLAMA_MODEL ?? 'glm-5.3-flash';
    ollama = new OllamaClient({
      baseUrl: ollamaBaseUrl,
      model: ollamaModel,
      apiKeyEnvVar: 'OLLAMA_API_KEY',
    });
  }
  // DEEP_RESEARCH profile runs on the heavier research model (Ollama stack
  // only — the env name is Ollama-specific; other providers keep their single
  // model). Falls back to the provider default when unset.
  const deepResearchModel = aiProvider === 'ollama'
    ? (process.env.OLLAMA_DEEP_RESEARCH_MODEL?.trim() || 'glm-5.3')
    : undefined;

  // Construct the AgentController over the OllamaClient + BrowserActionService.
  // The vault is passed as a VaultPort so the agent can use vault.has/fill/
  // generate_and_store. The agent NEVER gets vault.getPassword or vault.decrypt
  // — those methods don't exist in the VaultPort interface.
  const encryption = new SafeStorageEncryptionAdapter();
  credentialVault = new CredentialVault({
    encryption,
    storage: fileVaultStorageFor(app.getPath('userData')),
    resolveWebContents: (tabId) => browserCore!.resolveWebContents(tabId),
  });

  const memoryStore = new MemoryStore(fileStorageFor(app.getPath('userData'), 'memory.json'));
  void memoryStore.load();

  agentController = new AgentController({
    ollama,
    deepResearchModel,
    actions: browserActionService,
    vault: credentialVault,
    memory: memoryStore,
    pushMemoryPrompt: (update) => broadcastPushEvent('memory:prompt:update', update),
    overlay: new AgentOverlay({
      resolveWebContents: (tabId) => browserCore!.resolveWebContents(tabId),
    }),
    // Compose the renderer push events with the MCP ownership arbitration:
    // whenever the internal agent's state changes, the execution owner
    // follows (RUNNING/STOPPING → INTERNAL_AGENT, terminal → NONE).
    callbacks: (() => {
      const base = makeControllerCallbacks();
      return {
        ...base,
        onStateChange: (snapshot) => {
          mcpOwnershipGuard?.markInternalAgentActive(isAgentStateActive(snapshot.state));
          base.onStateChange?.(snapshot);
        },
      };
    })(),
  });

  // PROMPT 8 — Local MCP Server. A thin external adapter over the EXISTING
  // layers: browser tools → BrowserActionService (single execution layer),
  // agent tools → AgentController (single agent runtime), take_control →
  // the EXISTING takeover logic. No second automation layer.
  mcpOwnershipGuard = new McpOwnershipGuard();
  const mcpBrowserPort: McpBrowserPort = {
    dispatch: (input: ActionInput) =>
      browserActionService!.dispatch(input) as Promise<ActionResult<unknown>>,
    startExecutionContext: () => browserActionService!.startExecutionContext(),
    stopExecutionContext: (opts) => browserActionService!.stopExecutionContext(opts),
  };
  const mcpHandler = new McpToolHandler({
    browser: mcpBrowserPort,
    agent: agentController,
    ownership: mcpOwnershipGuard,
    // Dark-web tools (darkweb_search / darkweb_fetch / darkweb_crawl …)
    // through the single DarkWebService surface.
    darkweb: darkWebService?.mcpPort(),
    // Unified-runtime diagnostics (Perplexica / SearXNG / Tor states).
    runtimeStatus: () => runtimeManager?.getStatus() ?? null,
  });
  const mcpPortEnv = Number.parseInt(process.env.MCP_SERVER_PORT ?? '', 10);
  mcpServer = new McpServerRuntime({
    handler: mcpHandler,
    ownership: mcpOwnershipGuard,
    port: Number.isInteger(mcpPortEnv) && mcpPortEnv > 0 && mcpPortEnv < 65_536
      ? mcpPortEnv
      : undefined,
  });

  return win;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
async function handlePabRequest(request: Request): Promise<Response> {
  console.log('[pab] handler hit:', request.url);
  try {
    const host = new URL(request.url).host;
    if (host === 'darkweb') {
      // Dark Web Search page + same-origin mini-API (never touches the net
      // directly — every onion byte goes through DarkWebService → Tor).
      if (darkWebService) {
        return await handleDarkWebPabRequest(request, {
          service: darkWebService,
          openDarkWebTab: (url) => {
            if (!browserCore) return false;
            browserCore.openTab({ url, darkweb: true, activate: true });
            return true;
          },
          downloads: darkWebDownloads,
        });
      }
      return new Response('Dark web subsystem unavailable', { status: 503 });
    }
    if (host === 'search') {
      // Endpoint preference (spec §2/§29): managed runtime FIRST; the env
      // URL is a DEV-ONLY adopt fallback when the manager is absent.
      const perplexicaUrl = runtimeManager?.getEndpoint('perplexica')
        ?? process.env.PAB_PERPLEXICA_URL?.trim()
        ?? 'http://127.0.0.1:3000';
      // Root-cause fix: pick a chat model VERIFIED live against the Gemini
      // API — Perplexica's live list starts with keys that 404 for the
      // account (e.g. models/gemini-2.5-flash), and such a 404 makes the
      // non-stream search promise hang forever.
      const verifiedModel = await resolvePreferredChatModel();
      return new Response(
        buildSearchPageHtml({
          perplexicaURL: perplexicaUrl,
          modelKey: verifiedModel
            ?? process.env.PAB_PERPLEXICA_MODEL?.trim()
            ?? 'deepseek-v4-pro:0813',
        }),
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
    if (host === 'newtab') {
      // JSON side-channel for the strip's cold-boot retry.
      if (new URL(request.url).pathname === '/api/news') {
        const items = await fetchTechNews(fetch);
        return new Response(JSON.stringify({ items }), {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      const topSites = computeTopSites(
        browserCore ? await browserCore.queryHistory({ limit: 200 }) : [],
        8
      );
      // Today-in-Tech strip — REAL Hacker News top stories (offline → []).
      const news = await fetchTechNews(fetch);
      return new Response(buildNewTabHtml(topSites, news), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
  } catch (err) {
    console.error('[pab] handler failed:', err);
  }
  return new Response('Not found', { status: 404 });
}

// ---------------------------------------------------------------------------
// Window controls — the frameless Matrix title bar needs real min/max/close.
// Senders are limited to OUR chrome renderer (the only surface that has the
// chrome preload); tab pages never get these channels.
// ---------------------------------------------------------------------------
function registerWindowIpcHandlers(): void {
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on('window:toggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

function bootstrap(): void {
  installErrorHandlers();
  if (!acquireSingleInstanceLock()) {
    return; // app.quit() already invoked.
  }

  // Internal pages (pab://newtab) — must be registered as privileged
  // BEFORE app ready. The handler itself is attached after ready, when
  // the history store (top sites data source) exists.
  // supportFetchAPI: the pab://darkweb page talks to its own mini-API via
  // same-origin fetch() — without this privilege Chromium rejects those
  // requests outright ("Failed to fetch").
  protocol.registerSchemesAsPrivileged([
    { scheme: 'pab', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);

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
    createMainWindow(); // constructs BrowserCore + BrowserActionService + AgentController + CredentialVault + MCP server
    registerIpcHandlers(browserCore ?? undefined);
    setRuntimeEndpointProvider(() =>
      runtimeManager?.getEndpoint('perplexica')
      ?? process.env.PAB_PERPLEXICA_URL?.trim()
      ?? 'http://127.0.0.1:3000'
    );
    // Internal pab:// pages — served from the default session AND every
    // tab session (pab handler must exist on the session that loads it).
    protocol.handle('pab', handlePabRequest);
    if (agentController) {
      registerAgentIpcHandlers(agentController);
      // Scoped pab://newtab bridge (attachments + Deep Research start) —
      // handlers re-validate the sender URL on every call.
      registerNewTabIpcHandlers(agentController);
    }
    registerWindowIpcHandlers();
    if (credentialVault) {
      registerVaultIpcHandlers({
        vault: credentialVault,
        capture: new PasswordCaptureService(),
        resolveTabMeta: (wc) => browserCore!.resolveTabMetaByWebContents(wc),
        getTabUrl: (tabId) => browserCore!.getTab(tabId)?.url ?? null,
        broadcast: (channel, payload) => broadcastPushEvent(channel, payload),
      });
    }
    // Unified runtime engines (Perplexica/SearXNG/Tor) start ASYNC — the
    // window is already visible and never waits for backends (spec §33).
    if (runtimeManager) {
      void runtimeManager.start();
      // One Tor for the whole browser: the darkweb subsystem adopts the
      // managed gateway instead of probing/spawning its own.
      darkWebService?.attachManagedTor({
        isReady: () => runtimeManager?.getStatus().tor?.state === 'READY',
        endpoint: () => runtimeManager?.getSocksEndpoint() ?? null,
      });
    }
    // Local MCP server — localhost-only. A startup failure (e.g. port
    // occupied) is EXPLICIT: logged loudly, the browser keeps working.
    if (mcpServer) {
      mcpServer
        .start()
        .then(() => {
          const s = mcpServer!.status();
          console.log(`[mcp] local MCP server listening on http://${s.host}:${s.port}/mcp (${s.toolCount} tools)`);
        })
        .catch((err: unknown) => {
          console.error('[mcp] LOCAL MCP SERVER NOT STARTED:', err instanceof Error ? err.message : err);
        });
    }
  });

  app.on('render-process-gone', (_evt, _wc, details) => {
    console.error('[main] render-process-gone:', details);
  });

  app.on('child-process-gone', (_evt, details) => {
    console.error('[main] child-process-gone:', details);
  });

  // On quit, ensure managed engines are stopped BEFORE anything else —
  // no orphan tor.exe / node processes survive HayDevBrowser (spec §74).
  app.on('before-quit', () => {
    if (runtimeManager) {
      // Tree-kills perplexica/searxng/tor children + final orphan sweep.
      void runtimeManager.stop();
    }
    if (mcpServer) {
      // Graceful MCP shutdown — no dangling listener stays behind.
      void mcpServer.stop();
    }
    if (agentController) {
      agentController.dispose();
    }
    if (browserActionService) {
      browserActionService.dispose();
    }
    if (credentialVault) {
      credentialVault.dispose();
    }
    if (darkWebService) {
      // Kill spawned tor, abort crawls — no zombie processes (spec §45).
      darkWebService.dispose();
    }
    if (darkWebDownloads) {
      // Wipe still-quarantined downloads (spec §14 — never leave payloads).
      void darkWebDownloads.cleanup();
    }
    if (browserCore) {
      void browserCore.dispose();
    }
  });
}

bootstrap();
