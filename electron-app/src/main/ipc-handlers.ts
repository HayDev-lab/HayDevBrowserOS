/**
 * IPC handlers — Main process side.
 *
 * Implements the typed IPC contract defined in src/shared/ipc-types.ts.
 * Only these channels may be invoked by the renderer (via the preload bridge).
 */
import { ipcMain, app, BrowserWindow } from 'electron';
import type {
  AppVersionInfo,
  FoundationPingPayload,
  FoundationPingResult,
} from '@shared/ipc-types';

const ALLOWED_SEND_CHANNELS = new Set<string>([
  // Reserved for future forward-only notifications from main to renderer.
]);

export function registerIpcHandlers(): void {
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
