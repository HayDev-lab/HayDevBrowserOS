/**
 * Control store — React hook wrapping the pure `ControlState` machine from
 * `ui-logic.ts` for use in components.
 *
 * This is a LOCAL deterministic state only — NO IPC, NO Ollama, NO Agent Runtime.
 * The actual Agent Runtime will be wired in PROMPT 5; until then, the UI shell
 * consumes this hook to render HUMAN/AGENT visuals deterministically.
 */
import { useCallback, useState } from 'react';
import {
  DEFAULT_CONTROL_STATE,
  applyTakeControl,
  clearTakeoverLatch,
  switchToAgent,
  setAgentRunning,
  getTakeControlVisibility,
  canTransitionControlMode,
  type ControlState,
  type ControlMode,
} from './ui-logic';

export interface UseControlState {
  state: ControlState;
  mode: ControlMode;
  agentRunning: boolean;
  takeoverLatched: boolean;
  takeControlVisibility: ReturnType<typeof getTakeControlVisibility>;
  /** HUMAN → AGENT. Refuses if agent is currently running. */
  activateAgent: () => void;
  /** AGENT → HUMAN. Unconditional — TAKE CONTROL always succeeds. */
  takeControl: () => void;
  /** Clear the takeover latch after the user acknowledges it. */
  acknowledgeTakeover: () => void;
  /** Mark the agent loop as started/stopped. */
  setAgentRunning: (running: boolean) => void;
  /** True if a transition to `mode` is currently allowed. */
  canTransitionTo: (mode: ControlMode) => boolean;
  /** Reset to the default HUMAN idle state. */
  reset: () => void;
}

export function useControlState(): UseControlState {
  const [state, setState] = useState<ControlState>(DEFAULT_CONTROL_STATE);

  const activateAgent = useCallback(() => {
    setState((s) => switchToAgent(s));
  }, []);

  const takeControl = useCallback(() => {
    setState((s) => applyTakeControl(s));
  }, []);

  const acknowledgeTakeover = useCallback(() => {
    setState((s) => clearTakeoverLatch(s));
  }, []);

  const setAgentRunningCb = useCallback((running: boolean) => {
    setState((s) => setAgentRunning(s, running));
  }, []);

  const canTransitionTo = useCallback(
    (mode: ControlMode) => canTransitionControlMode(state, mode),
    [state]
  );

  const reset = useCallback(() => {
    setState(DEFAULT_CONTROL_STATE);
  }, []);

  return {
    state,
    mode: state.mode,
    agentRunning: state.agentRunning,
    takeoverLatched: state.takeoverLatched,
    takeControlVisibility: getTakeControlVisibility(state),
    activateAgent,
    takeControl,
    acknowledgeTakeover,
    setAgentRunning: setAgentRunningCb,
    canTransitionTo,
    reset,
  };
}
