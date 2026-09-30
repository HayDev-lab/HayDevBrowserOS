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
  // Agent run lifecycle. Pending attachments (agent panel / New Tab) are
  // resolved MAIN-side into bounded digests + vision images before the run.
  ipcMain.handle('agent:run', (_evt, req: AgentRunRequest): Promise<AgentRunResult> => {
    const enriched = enrichWithAttachments(req);
    return controller.run(enriched);
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

  // PROMPT 9 — last Deep Research report (in-memory only).
  ipcMain.handle('agent:research:report', () => {
    return Promise.resolve(controller.getResearchReport());
  });

  // Agent memory confirmation prompt (memory.save tool → user confirmation).
  ipcMain.handle('memory:prompt:current', () => {
    return Promise.resolve(controller.getMemoryPrompt());
  });

  ipcMain.handle('memory:prompt:resolve', (_evt, answer: unknown) => {
    const opts = (answer ?? {}) as { promptId?: string; save?: boolean };
    if (typeof opts.promptId !== 'string') {
      return Promise.resolve({ success: false });
    }
    return controller.resolveMemoryPrompt(opts.promptId, opts.save === true);
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
 *
 * Targets BOTH the windows' own webContents AND the registered chrome
 * view webContents: the React chrome lives in a WebContentsView, whose
 * webContents is NOT win.webContents, so window-only delivery never
 * reaches the UI. Deliberately NOT webContents.getAllWebContents() —
 * that would leak internal agent/timeline state into guest page
 * webContents (i.e., loaded websites).
 */
const pushTargets = new Set<Electron.WebContents>();

export function registerPushTarget(target: Electron.WebContents | null): void {
  if (target) pushTargets.add(target);
}

export function broadcastPushEvent(channel: string, payload: unknown): void {
  const ALLOWED_PUSH_CHANNELS = new Set([
    'agent:state:update',
    'agent:timeline:update',
    'control:mode:update',
    'vault:prompt:update',
    'memory:prompt:update',
  ]);
  if (!ALLOWED_PUSH_CHANNELS.has(channel)) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
  for (const wc of pushTargets) {
    if (!wc.isDestroyed()) {
      wc.send(channel, payload);
    } else {
      pushTargets.delete(wc);
    }
  }
}

// ---------------------------------------------------------------------------
// Callback factory — used by main/index.ts when constructing the controller
// ---------------------------------------------------------------------------

import type { AgentControllerCallbacks } from './browser/agent/runtime/agent-controller';
import { resolvePendingAttachments } from './newtab-ipc-handlers';
import { composeResearchCommand } from '@shared/newtab-bridge';

/**
 * Fold pending attachments into the run request: text digests are appended
 * to the command; images ride the vision channel. Single-use — consumed
 * ids are dropped by the registry.
 */
function enrichWithAttachments(req: AgentRunRequest): AgentRunRequest {
  if (!req || !Array.isArray(req.attachmentIds) || req.attachmentIds.length === 0) {
    return req;
  }
  const { digests, images } = resolvePendingAttachments(req.attachmentIds);
  const command =
    digests.length > 0 ? composeResearchCommand(req.command, digests) : req.command;
  return {
    ...req,
    command,
    attachmentIds: undefined,
    ...(images.length > 0 && !(req.images && req.images.length > 0) ? { images } : {}),
  };
}

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
