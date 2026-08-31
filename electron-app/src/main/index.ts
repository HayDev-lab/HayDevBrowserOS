/**
 * Electron MAIN process — Personal Agentic Browser (Foundation v0.1).
 *
 * Scope of this file (PROMPT 1):
 *  - app lifecycle (single-instance lock, ready, window-creation, quit)
 *  - BrowserWindow with the mandated security baseline for REMOTE web content
 *  - registration of the typed IPC handlers
 *  - minimal error handling (uncaughtException, unhandledRejection,
 *    render-process-gone, child-process-gone)
 *
 * NON-GOALS for this stage:
 *  - tabs / multi-window browser core
 *  - preload that exposes anything beyond the foundation bridge
 *  - AI / Ollama / MCP / Vault / Incognito / Deep Research
 */
import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc-handlers';

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
function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, 'preload.js');

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
      // ──────────────────────────────────────────────────────────────
      // SECURITY BASELINE (NON-NEGOTIABLE per Shared Project Context)
      // ──────────────────────────────────────────────────────────────
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // No remote module — removed since Electron 14; not re-enabled.
      // Load the preload bridge that exposes the typed `window.api`.
      preload: preloadPath,
      // Disable bypass of CSP via webSecurity toggles at runtime.
      javascript: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Open external links in the user's default browser, not inside the app window.
  // (Will be revisited in PROMPT 2 for in-app navigation policy.)
  win.webContents.setWindowOpenHandler(({ url }) => {
    setImmediate(() => {
      void shell.openExternal(url);
    });
    return { action: 'deny' };
  });

  // Load the renderer bundle produced by @electron-forge/plugin-vite.
  // MAIN_VITE_ENTRY is injected by the Vite plugin at dev/build time.
  const devUrl = typeof MAIN_VITE_ENTRY === 'string' ? MAIN_VITE_ENTRY : undefined;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    // Production-style load from disk (also used by `electron-vite build` smoke test).
    const prodPath =
      typeof RENDERER_VITE_ENTRY === 'string'
        ? RENDERER_VITE_ENTRY
        : path.join(__dirname, '../renderer/index.html');
    void win.loadFile(prodPath);
  }

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
    registerIpcHandlers();
    createMainWindow();
  });

  app.on('render-process-gone', (_evt, _wc, details) => {
    console.error('[main] render-process-gone:', details);
  });

  app.on('child-process-gone', (_evt, details) => {
    console.error('[main] child-process-gone:', details);
  });
}

bootstrap();
