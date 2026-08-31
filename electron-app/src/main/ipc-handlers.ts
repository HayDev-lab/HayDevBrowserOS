/**
 * IPC handlers — Main process side.
 *
 * Implements the typed IPC contract defined in src/shared/ipc-types.ts.
 * Only these channels may be invoked by the renderer (via the preload bridge).
 *
 * PROMPT 2: extends the foundation handlers with Browser Core handlers that
 * delegate to a shared `BrowserCore` instance.
 */
import { ipcMain, app, BrowserWindow } from 'electron';
import type {
  AppVersionInfo,
  FoundationPingPayload,
  FoundationPingResult,
  OpenTabRequest,
  NavigateRequest,
  TabIdRequest,
  HistoryQuery,
  HistoryAddRequest,
  BookmarkAddRequest,
} from '@shared/ipc-types';
import type { BrowserCore } from './browser/runtime/browser-core';

const ALLOWED_SEND_CHANNELS = new Set<string>([
  // Reserved for future forward-only notifications from main to renderer.
]);

// ---------------------------------------------------------------------------
// Foundation handlers
// ---------------------------------------------------------------------------
function registerFoundationHandlers(): void {
  ipcMain.handle('app:version', (): AppVersionInfo => {
    return {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      appVersion: app.getVersion(),
    };
  });

  ipcMain.handle(
    'foundation:ping',
    (_evt, payload: FoundationPingPayload): FoundationPingResult => {
      return {
        receivedAt: Date.now(),
        echoed: payload,
      };
    }
  );
}

// ---------------------------------------------------------------------------
// Browser Core handlers — delegate to the singleton BrowserCore instance.
// ---------------------------------------------------------------------------
function registerBrowserHandlers(core: BrowserCore): void {
  // Tabs
  ipcMain.handle('browser:tabs:list', () => core.listTabs());

  ipcMain.handle('browser:tabs:open', (_evt, req: OpenTabRequest) =>
    core.openTab({
      url: req.url,
      activate: req.activate,
      incognito: req.incognito,
    })
  );

  ipcMain.handle('browser:tabs:close', (_evt, req: TabIdRequest) =>
    core.closeTab(req.tabId)
  );

  ipcMain.handle('browser:tabs:activate', (_evt, req: TabIdRequest) =>
    core.activateTab(req.tabId)
  );

  // Navigation
  ipcMain.handle('browser:navigate', (_evt, req: NavigateRequest) =>
    core.navigateTab(req.tabId, req.url)
  );

  ipcMain.handle('browser:back', (_evt, req: TabIdRequest) => core.back(req.tabId));
  ipcMain.handle('browser:forward', (_evt, req: TabIdRequest) => core.forward(req.tabId));
  ipcMain.handle('browser:reload', (_evt, req: TabIdRequest) => core.reload(req.tabId));
  ipcMain.handle('browser:stop', (_evt, req: TabIdRequest) => core.stop(req.tabId));

  // History
  ipcMain.handle('browser:history:query', (_evt, q: HistoryQuery) =>
    core.queryHistory(q)
  );
  ipcMain.handle('browser:history:delete', (_evt, id: string) =>
    core.deleteHistory(id)
  );
  ipcMain.handle('browser:history:clear', () => core.clearHistory());
  ipcMain.handle('browser:history:add', (_evt, req: HistoryAddRequest) =>
    core.addHistory(req)
  );

  // Bookmarks
  ipcMain.handle('browser:bookmarks:list', () => core.listBookmarks());
  ipcMain.handle('browser:bookmarks:add', (_evt, req: BookmarkAddRequest) =>
    core.addBookmark(req)
  );
  ipcMain.handle('browser:bookmarks:delete', (_evt, id: string) =>
    core.deleteBookmark(id)
  );

  // Downloads
  ipcMain.handle('browser:downloads:list', () => core.listDownloads());
  ipcMain.handle('browser:downloads:cancel', (_evt, id: string) =>
    core.cancelDownload(id)
  );
  ipcMain.handle('browser:downloads:remove', (_evt, id: string) =>
    core.removeDownload(id)
  );
}

export function registerIpcHandlers(core?: BrowserCore): void {
  registerFoundationHandlers();
  if (core) {
    registerBrowserHandlers(core);
  }
}

export function broadcastToRenderers(channel: string, data: unknown): void {
  if (!ALLOWED_SEND_CHANNELS.has(channel)) {
    // Whitelist is intentionally restrictive; do not leak arbitrary channels.
    return;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}
