import { platformApi } from '../platform';
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
 *   - platformApi.agent.run / stop / status / listTimeline
 *   - platformApi.control.setMode / takeControl / getMode
 *
 * Replaces the local-deterministic `useControlState` from PROMPT 3 for the
 * agent runtime — but the visual layer (ControlModule) still uses
 * `useControlState` for instant UI feedback, and this store syncs the
 * runtime state back to it via the `onModeChange` callback.
 */
import { useEffect, useState, useCallback } from 'react';
import { appendChatEntry, appendChatStateTransition } from './chat-logic';
import type { ChatMessage } from './chat-logic';
import type {
  AgentRunResult,
  AgentStatusSnapshot,
  AgentTimelineEntry,
  ControlMode,
  ControlModeUpdate,
  AgentStateSnapshot,
  ResearchReport,
} from '@shared/ipc-types';

export interface UseAgentStore {
  // Status
  status: AgentStatusSnapshot | null;
  timeline: AgentTimelineEntry[];
  controlMode: ControlMode;
  // Actions
  run: (command: string, opts?: { maxSteps?: number; attachmentIds?: string[] }) => Promise<AgentRunResult>;
  /** DEEP_RESEARCH profile run (PROMPT 9) — same runtime, research report at the end. */
  runResearch: (query: string) => Promise<AgentRunResult>;
  /** Last research report (fetched after a research run settles). */
  researchReport: ResearchReport | null;
  /** True while a DEEP_RESEARCH run is active (drives the phase badge). */
  researchMode: boolean;
  /** Fetch + store the latest research report from the main process. */
  refreshResearchReport: () => Promise<void>;
  stop: (reason?: string) => Promise<{ accepted: boolean }>;
  setMode: (mode: ControlMode) => Promise<{ accepted: boolean; reason?: string }>;
  takeControl: (reason?: string) => Promise<{ accepted: boolean }>;
  refreshStatus: () => Promise<void>;
  refreshTimeline: () => Promise<void>;
  /** Clean conversation transcript (user queries + agent answers). */
  chat: ChatMessage[];
  clearChat: () => void;
}

export function useAgentStore(): UseAgentStore {
  const [status, setStatus] = useState<AgentStatusSnapshot | null>(null);
  const [timeline, setTimeline] = useState<AgentTimelineEntry[]>([]);
  const [controlMode, setControlMode] = useState<ControlMode>('HUMAN');
  const [researchReport, setResearchReport] = useState<ResearchReport | null>(null);
  const [researchMode, setResearchMode] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);

  // Initial load + push event subscription.
  // NOTE: no `initialized` ref guard here — React 18 StrictMode mounts,
  // unmounts and remounts every effect once in dev; with a guard the
  // cleanup of the first mount permanently kills the push subscriptions.
  useEffect(() => {
    // Initial fetch.
    void platformApi.agent.status().then(setStatus).catch(() => {});
    void platformApi.agent.listTimeline().then(setTimeline).catch(() => {});
    void platformApi.control.getMode().then(setControlMode).catch(() => {});

    // Subscribe to push events.
    let lastAgentState: string | null = null;
    const offState = platformApi.on('agent:state:update', (data) => {
      const snapshot = data as AgentStateSnapshot;
      // Failed runs close the loop in the chat with an error bubble.
      setChat((chatPrev) =>
        appendChatStateTransition(
          chatPrev,
          lastAgentState,
          snapshot,
          () => `chat_err_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`
        )
      );
      lastAgentState = snapshot.state ?? null;
      setStatus((prev) => {
        if (!prev) {
          // Build a minimal snapshot if the controller only sent the state field.
          return prev;
        }
        return { ...prev, ...snapshot } as AgentStatusSnapshot;
      });
    });

    const offTimeline = platformApi.on('agent:timeline:update', (data) => {
      const update = data as
        | { kind: 'add'; entry: AgentTimelineEntry }
        | { kind: 'clear' };
      if (update.kind === 'add') {
        setTimeline((prev) => [...prev, update.entry]);
        setChat((chatPrev) => appendChatEntry(chatPrev, update.entry));
      } else if (update.kind === 'clear') {
        // The technical timeline resets per run; the CHAT transcript
        // persists across runs (it is the conversation, not the log).
        setTimeline([]);
      }
    });

    const offMode = platformApi.on('control:mode:update', (data) => {
      const update = data as ControlModeUpdate;
      setControlMode(update.mode);
    });

    return () => {
      offState?.();
      offTimeline?.();
      offMode?.();
    };
  }, []);

  const run = useCallback(
    async (command: string, opts?: { maxSteps?: number; attachmentIds?: string[] }) => {
      return platformApi.agent.run({
        command,
        maxSteps: opts?.maxSteps,
        ...(opts?.attachmentIds && opts.attachmentIds.length > 0
          ? { attachmentIds: opts.attachmentIds }
          : {}),
      });
    },
    []
  );

  const runResearch = useCallback(async (query: string) => {
    setResearchMode(true);
    try {
      return await platformApi.agent.run({ command: query, profile: 'DEEP_RESEARCH' });
    } finally {
      setResearchMode(false);
      // Report is built when the run settles — fetch it either way.
      try {
        setResearchReport(await platformApi.agent.researchReport());
      } catch {
        // ignore — report fetch is non-critical
      }
    }
  }, []);

  const refreshResearchReport = useCallback(async () => {
    try {
      setResearchReport(await platformApi.agent.researchReport());
    } catch {
      // ignore
    }
  }, []);

  const stop = useCallback(async (reason?: string) => {
    return platformApi.agent.stop(reason);
  }, []);

  const setMode = useCallback(async (mode: ControlMode) => {
    const result = await platformApi.control.setMode(mode);
    if (result.accepted) {
      setControlMode(mode);
    }
    return result;
  }, []);

  const takeControl = useCallback(async (reason?: string) => {
    const result = await platformApi.control.takeControl(reason);
    if (result.accepted) {
      setControlMode('HUMAN');
    }
    return result;
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await platformApi.agent.status());
    } catch {
      // ignore — non-critical
    }
  }, []);

  const refreshTimeline = useCallback(async () => {
    try {
      setTimeline(await platformApi.agent.listTimeline());
    } catch {
      // ignore
    }
  }, []);

  return {
    status,
    timeline,
    controlMode,
    run,
    runResearch,
    researchReport,
    researchMode,
    refreshResearchReport,
    stop,
    setMode,
    takeControl,
    refreshStatus,
    refreshTimeline,
    chat,
    clearChat: () => setChat([]),
  };
}
