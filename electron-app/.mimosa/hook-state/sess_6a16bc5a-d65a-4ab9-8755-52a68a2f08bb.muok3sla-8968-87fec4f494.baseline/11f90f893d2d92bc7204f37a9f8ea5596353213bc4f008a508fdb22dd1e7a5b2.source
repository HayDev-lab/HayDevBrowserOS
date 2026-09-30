/**
 * Control authorization — pure logic.
 *
 * Enforces the HUMAN/AGENT boundary for agent tool execution.
 *
 * HUMAN mode:
 *   - All browser tool calls are DENIED.
 *   - `agent.stop` is ALLOWED (so the model can gracefully end a run that
 *     was interrupted by TAKE CONTROL — though in practice the controller
 *     aborts before the model gets a chance).
 *
 * AGENT mode:
 *   - All V1 tools are ALLOWED.
 *
 * TAKE CONTROL:
 *   - Transitions CONTROL_MODE → HUMAN.
 *   - Aborts the current execution context.
 *   - Subsequent tool calls are DENIED.
 *   - Browser state (tabs, sessions, page) is PRESERVED — the authorization
 *     layer never destroys browser state, only refuses new agent actions.
 *
 * NO electron import. Fully unit-testable.
 */
import type { ControlMode, AuthorizationDecision, ToolName } from '@shared/agent-types';

export interface ControlAuthorizationState {
  mode: ControlMode;
  /** True if TAKE CONTROL has been requested (latched until cleared). */
  takeoverLatched: boolean;
  /** True if an agent run is currently active. */
  agentRunActive: boolean;
}

export const DEFAULT_CONTROL_AUTHORIZATION: ControlAuthorizationState = {
  mode: 'HUMAN',
  takeoverLatched: false,
  agentRunActive: false,
};

// ---------------------------------------------------------------------------
// Authorization checks
// ---------------------------------------------------------------------------

/**
 * Check whether a tool call is authorized given the current control state.
 *
 * Rules:
 *   - If takeoverLatched is true → DENY (until the latch is cleared via
 *     `clearTakeoverLatch()`).
 *   - If mode === 'HUMAN' → DENY all browser tools; allow only `agent.stop`.
 *   - If mode === 'AGENT' → ALLOW all V1 tools.
 */
export function authorizeToolCall(
  state: ControlAuthorizationState,
  tool: ToolName
): AuthorizationDecision {
  // TAKE CONTROL latch: deny everything (even agent.stop — the controller
  // will abort the run directly).
  if (state.takeoverLatched) {
    return {
      allowed: false,
      reason: 'takeover_latched',
    };
  }

  if (state.mode === 'HUMAN') {
    // HUMAN mode: deny browser tools; allow only agent.stop.
    if (tool === 'agent.stop') {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: 'human_mode_denies_browser_tools',
    };
  }

  // AGENT mode: allow all V1 tools.
  return { allowed: true };
}

/**
 * True if a new agent run can be started in the current state.
 * Requires AGENT mode and no active run and no latched takeover.
 */
export function canStartAgentRun(state: ControlAuthorizationState): boolean {
  return (
    state.mode === 'AGENT' &&
    !state.agentRunActive &&
    !state.takeoverLatched
  );
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Switch to AGENT mode. Refuses if an agent run is currently active.
 */
export function switchToAgent(
  state: ControlAuthorizationState
): ControlAuthorizationState {
  if (state.mode === 'AGENT') return state;
  if (state.agentRunActive) {
    // Refuse — must stop the current run first.
    return state;
  }
  return {
    mode: 'AGENT',
    takeoverLatched: false,
    agentRunActive: false,
  };
}

/**
 * Switch to HUMAN mode (TAKE CONTROL). Unconditional — always succeeds.
 * Latches the takeover flag so subsequent tool calls are denied until
 * the user acknowledges.
 *
 * CRITICAL: this function does NOT destroy browser state. It only updates
 * the authorization state. The caller (AgentController) is responsible for
 * aborting the execution context, but the BrowserCore / tabs / sessions
 * are untouched.
 */
export function takeControl(
  state: ControlAuthorizationState,
  _reason: string = 'user_request'
): ControlAuthorizationState {
  // Always transition to HUMAN + latch takeover.
  // Note: `_reason` is accepted for API symmetry but not stored in the
  // authorization state — the AgentController records it in the agent
  // state machine's reason field.
  return {
    mode: 'HUMAN',
    takeoverLatched: true,
    agentRunActive: false, // The run is considered inactive after takeover.
  };
}

/**
 * Clear the takeover latch. Called after the user has acknowledged the
 * takeover (e.g. by interacting with the UI or starting a new run).
 */
export function clearTakeoverLatch(
  state: ControlAuthorizationState
): ControlAuthorizationState {
  if (!state.takeoverLatched) return state;
  return { ...state, takeoverLatched: false };
}

/**
 * Mark an agent run as started. Refuses if not in AGENT mode or if a run
 * is already active.
 */
export function markAgentRunStarted(
  state: ControlAuthorizationState
): ControlAuthorizationState {
  if (!canStartAgentRun(state)) return state;
  return { ...state, agentRunActive: true };
}

/**
 * Mark an agent run as ended (completed/failed/stopped).
 */
export function markAgentRunEnded(
  state: ControlAuthorizationState
): ControlAuthorizationState {
  if (!state.agentRunActive) return state;
  return { ...state, agentRunActive: false };
}

/**
 * Reset to the default HUMAN idle state.
 */
export function resetControlAuthorization(): ControlAuthorizationState {
  return { ...DEFAULT_CONTROL_AUTHORIZATION };
}
