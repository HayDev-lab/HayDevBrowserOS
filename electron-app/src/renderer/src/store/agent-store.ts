/**
 * Agent store — renderer-side React hook mirroring the main-process
 * AgentController via IPC + push events.
 *
 * Subscribes to:
 *   - agent:state:update (push)
 *   - agent:timeline:update (push)
 *   - control:mode:update (push)
 *
 * Exposes typed actions that call:
 *   - window.api.agent.run / stop / status / listTimeline
 *   - window.api.control.setMode / takeControl / getMode
 *
 * Replaces the local-deterministic `useControlState` from PROMPT 3 for the
 * agent runtime — but the visual layer (ControlModule) still uses
 * `useControlState` for instant UI feedback, and this store syncs the
 * runtime state back to it via the `onModeChange` callback.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  AgentRunResult,
  AgentStatusSnapshot,
  AgentTimelineEntry,
  ControlMode,
  ControlModeUpdate,
  AgentStateSnapshot,
} from '@shared/ipc-types';

export interface UseAgentStore {
  // Status
  status: AgentStatusSnapshot | null;
  timeline: AgentTimelineEntry[];
  controlMode: ControlMode;
  // Actions
  run: (command: string, opts?: { maxSteps?: number }) => Promise<AgentRunResult>;
  stop: (reason?: string) => Promise<{ accepted: boolean }>;
  setMode: (mode: ControlMode) => Promise<{ accepted: boolean; reason?: string }>;
  takeControl: (reason?: string) => Promise<{ accepted: boolean }>;
  refreshStatus: () => Promise<void>;
  refreshTimeline: () => Promise<void>;
}

export function useAgentStore(): UseAgentStore {
  const [status, setStatus] = useState<AgentStatusSnapshot | null>(null);
  const [timeline, setTimeline] = useState<AgentTimelineEntry[]>([]);
  const [controlMode, setControlMode] = useState<ControlMode>('HUMAN');
  const initialized = useRef(false);

  // Initial load + push event subscription.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Initial fetch.
    void window.api.agent.status().then(setStatus).catch(() => {});
    void window.api.agent.listTimeline().then(setTimeline).catch(() => {});
    void window.api.control.getMode().then(setControlMode).catch(() => {});

    // Subscribe to push events.
    const offState = window.api.on('agent:state:update', (data) => {
      const snapshot = data as AgentStateSnapshot;
      setStatus((prev) => {
        if (!prev) {
          // Build a minimal snapshot if the controller only sent the state field.
          return prev;
        }
        return { ...prev, ...snapshot } as AgentStatusSnapshot;
      });
    });

    const offTimeline = window.api.on('agent:timeline:update', (data) => {
      const update = data as
        | { kind: 'add'; entry: AgentTimelineEntry }
        | { kind: 'clear' };
      if (update.kind === 'add') {
        setTimeline((prev) => [...prev, update.entry]);
      } else if (update.kind === 'clear') {
        setTimeline([]);
      }
    });

    const offMode = window.api.on('control:mode:update', (data) => {
      const update = data as ControlModeUpdate;
      setControlMode(update.mode);
    });

    return () => {
      offState?.();
      offTimeline?.();
      offMode?.();
    };
  }, []);

  const run = useCallback(async (command: string, opts?: { maxSteps?: number }) => {
    return window.api.agent.run({ command, maxSteps: opts?.maxSteps });
  }, []);

  const stop = useCallback(async (reason?: string) => {
    return window.api.agent.stop(reason);
  }, []);

  const setMode = useCallback(async (mode: ControlMode) => {
    const result = await window.api.control.setMode(mode);
    if (result.accepted) {
      setControlMode(mode);
    }
    return result;
  }, []);

  const takeControl = useCallback(async (reason?: string) => {
    const result = await window.api.control.takeControl(reason);
    if (result.accepted) {
      setControlMode('HUMAN');
    }
    return result;
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await window.api.agent.status());
    } catch {
      // ignore — non-critical
    }
  }, []);

  const refreshTimeline = useCallback(async () => {
    try {
      setTimeline(await window.api.agent.listTimeline());
    } catch {
      // ignore
    }
  }, []);

  return {
    status,
    timeline,
    controlMode,
    run,
    stop,
    setMode,
    takeControl,
    refreshStatus,
    refreshTimeline,
  };
}
