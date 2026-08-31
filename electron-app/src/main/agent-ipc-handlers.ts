/**
 * Agent IPC handlers — Main process side.
 *
 * Wires the AgentController to the typed IPC channels:
 *   - agent:run / agent:stop / agent:status / agent:timeline:list
 *   - control:setMode / control:takeControl / control:getMode
 *
 * Push events (main → renderer):
 *   - agent:state:update
 *   - agent:timeline:update
 *   - control:mode:update
 *
 * The handlers broadcast push events to ALL renderer webContents (the
 * renderer chrome + any tab views that subscribe — though in V1 only the
 * chrome subscribes).
 */
import { ipcMain, BrowserWindow } from 'electron';
import type {
  AgentRunRequest,
  AgentRunResult,
  AgentStatusSnapshot,
  AgentTimelineEntry,
  ControlMode,
  ControlModeUpdate,
} from '@shared/ipc-types';
import type { AgentController } from './browser/agent/runtime/agent-controller';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAgentIpcHandlers(controller: AgentController): void {
  // Agent run lifecycle.
  ipcMain.handle('agent:run', (_evt, req: AgentRunRequest): Promise<AgentRunResult> => {
    return controller.run(req);
  });

  ipcMain.handle('agent:stop', (_evt, reason?: string) => {
    return Promise.resolve(controller.stop(reason ?? 'user_request'));
  });

  ipcMain.handle('agent:status', (): AgentStatusSnapshot => {
    return controller.getStatus();
  });

  ipcMain.handle('agent:timeline:list', (): AgentTimelineEntry[] => {
    return controller.getTimeline();
  });

  // Control mode.
  ipcMain.handle('control:setMode', (_evt, mode: ControlMode) => {
    return Promise.resolve(controller.setMode(mode));
  });

  ipcMain.handle('control:takeControl', (_evt, reason?: string) => {
    return Promise.resolve(controller.takeControl(reason ?? 'user_request'));
  });

  ipcMain.handle('control:getMode', (): ControlMode => {
    return controller.getControlMode();
  });
}

// ---------------------------------------------------------------------------
// Push event broadcasters
// ---------------------------------------------------------------------------

/**
 * Wire the controller's callbacks to broadcast push events to all
 * renderer windows. Called once after the controller is constructed.
 */
export function wireAgentPushEvents(controller: AgentController): void {
  // Push event: agent state change.
  // (The controller calls onStateChange; we broadcast to all windows.)
  // We can't directly set the controller's callbacks after construction,
  // so we expose a method on the controller to add callbacks. For V1
  // simplicity, the controller constructor accepts callbacks — we pass
  // these broadcasters at construction time in main/index.ts.
  void controller; // referenced to avoid unused-param lint
}

/**
 * Broadcast a payload to all renderer windows on a push channel.
 * Used by the AgentController callbacks (passed at construction time).
 */
export function broadcastPushEvent(channel: string, payload: unknown): void {
  const ALLOWED_PUSH_CHANNELS = new Set([
    'agent:state:update',
    'agent:timeline:update',
    'control:mode:update',
  ]);
  if (!ALLOWED_PUSH_CHANNELS.has(channel)) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Callback factory — used by main/index.ts when constructing the controller
// ---------------------------------------------------------------------------

import type { AgentControllerCallbacks } from './browser/agent/runtime/agent-controller';

export function makeControllerCallbacks(): AgentControllerCallbacks {
  return {
    onStateChange: (snapshot) => {
      broadcastPushEvent('agent:state:update', snapshot);
    },
    onTimelineUpdate: (entry) => {
      broadcastPushEvent('agent:timeline:update', { kind: 'add', entry });
    },
    onControlModeChange: (update: ControlModeUpdate) => {
      broadcastPushEvent('control:mode:update', update);
    },
    onRunComplete: () => {
      // The final status is already pushed via onStateChange.
    },
  };
}
