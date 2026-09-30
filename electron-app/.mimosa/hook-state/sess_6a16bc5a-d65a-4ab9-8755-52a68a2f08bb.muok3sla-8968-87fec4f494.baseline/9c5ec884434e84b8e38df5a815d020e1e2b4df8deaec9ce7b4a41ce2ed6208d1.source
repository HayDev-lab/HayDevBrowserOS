/**
 * Agent state machine — pure logic.
 *
 * Models the lifecycle of a single agent run:
 *
 *   IDLE → RUNNING → COMPLETED
 *                 → FAILED
 *                 → STOPPING → STOPPED
 *
 * Invariants:
 *   - Only one run at a time. `start()` refuses if state !== 'IDLE'.
 *   - `stop()` transitions RUNNING → STOPPING (the loop will wind down
 *     and then call `markStopped()`).
 *   - Terminal states (STOPPED/COMPLETED/FAILED) can only transition to IDLE
 *     via `reset()`.
 *   - All transitions are explicit and validated.
 *
 * NO electron import. Fully unit-testable.
 */
import type { AgentStateName, AgentStateSnapshot } from '@shared/agent-types';

export interface AgentStateMachineSnapshot extends AgentStateSnapshot {}

const TERMINAL_STATES: ReadonlySet<AgentStateName> = new Set([
  'STOPPED',
  'COMPLETED',
  'FAILED',
]);

let _runIdCounter = 0;
function generateRunId(): string {
  _runIdCounter += 1;
  return `agent_run_${Date.now().toString(36)}_${_runIdCounter.toString(36)}`;
}

export class AgentStateMachine {
  private state: AgentStateName = 'IDLE';
  private reason: string | null = null;
  private stepCount = 0;
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private error: string | null = null;
  private runId: string | null = null;

  constructor(private now: () => number = () => Date.now()) {}

  /** Current state. */
  getState(): AgentStateName {
    return this.state;
  }

  /** True if the machine is in a terminal state. */
  isTerminal(): boolean {
    return TERMINAL_STATES.has(this.state);
  }

  /** True if the machine is currently running (RUNNING or STOPPING). */
  isActive(): boolean {
    return this.state === 'RUNNING' || this.state === 'STOPPING';
  }

  /** Current run id (or null if IDLE). */
  getRunId(): string | null {
    return this.runId;
  }

  /**
   * Start a new run. Refuses if not IDLE.
   * Returns the run id on success, null on refusal.
   */
  start(): string | null {
    if (this.state !== 'IDLE') return null;
    this.runId = generateRunId();
    this.state = 'RUNNING';
    this.reason = null;
    this.stepCount = 0;
    this.startedAt = this.now();
    this.endedAt = null;
    this.error = null;
    return this.runId;
  }

  /**
   * Increment the step count. Returns the new count.
   * Refuses (-1) if not RUNNING.
   */
  recordStep(): number {
    if (this.state !== 'RUNNING') return -1;
    this.stepCount += 1;
    return this.stepCount;
  }

  /**
   * Request a stop. Transitions RUNNING → STOPPING.
   * Returns true if the transition was accepted.
   */
  stop(reason: string = 'user_request'): boolean {
    if (this.state !== 'RUNNING') return false;
    this.state = 'STOPPING';
    this.reason = reason;
    return true;
  }

  /**
   * Mark the run as fully stopped (after the loop has wound down).
   * Transitions STOPPING → STOPPED.
   */
  markStopped(reason: string = 'stopped'): boolean {
    if (this.state !== 'STOPPING') return false;
    this.state = 'STOPPED';
    this.reason = reason;
    this.endedAt = this.now();
    return true;
  }

  /**
   * Mark the run as completed successfully.
   * Transitions RUNNING → COMPLETED (or STOPPING → COMPLETED if the loop
   * finished its last step just as stop was requested).
   */
  markCompleted(reason: string = 'completed'): boolean {
    if (this.state !== 'RUNNING' && this.state !== 'STOPPING') return false;
    this.state = 'COMPLETED';
    this.reason = reason;
    this.endedAt = this.now();
    return true;
  }

  /**
   * Mark the run as failed.
   * Transitions RUNNING or STOPPING → FAILED.
   */
  markFailed(error: string, reason: string = 'error'): boolean {
    if (this.state !== 'RUNNING' && this.state !== 'STOPPING') return false;
    this.state = 'FAILED';
    this.error = error;
    this.reason = reason;
    this.endedAt = this.now();
    return true;
  }

  /**
   * Reset to IDLE. Only allowed from terminal states.
   */
  reset(): boolean {
    if (!TERMINAL_STATES.has(this.state)) return false;
    this.state = 'IDLE';
    this.reason = null;
    this.stepCount = 0;
    this.startedAt = null;
    this.endedAt = null;
    this.error = null;
    this.runId = null;
    return true;
  }

  /** Snapshot the current state. */
  snapshot(): AgentStateMachineSnapshot {
    return {
      state: this.state,
      reason: this.reason,
      stepCount: this.stepCount,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      error: this.error,
    };
  }
}

// ---------------------------------------------------------------------------
// Transition validation — for documentation + tests
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<AgentStateName, AgentStateName[]> = {
  IDLE: ['RUNNING'],
  RUNNING: ['STOPPING', 'COMPLETED', 'FAILED'],
  STOPPING: ['STOPPED', 'COMPLETED', 'FAILED'],
  STOPPED: ['IDLE'],
  COMPLETED: ['IDLE'],
  FAILED: ['IDLE'],
};

export function isValidTransition(
  from: AgentStateName,
  to: AgentStateName
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidTransitions(from: AgentStateName): AgentStateName[] {
  return [...(VALID_TRANSITIONS[from] ?? [])];
}
