/**
 * AgentController — runtime orchestrator over OllamaClient + BrowserActionService.
 *
 * Owns:
 *   - The AgentStateMachine.
 *   - The ControlAuthorizationState (HUMAN/AGENT + takeover latch).
 *   - The timeline (list of AgentTimelineEntry).
 *   - An AbortSignal for the current run.
 *
 * Wires:
 *   - runAgentLoop (pure) to the OllamaClient + BrowserActionService.
 *   - Timeline updates → push events to the renderer (via callback).
 *   - State changes → push events to the renderer.
 *
 * DEFERRED_RUNTIME: this module imports `electron` transitively (via
 * BrowserActionService). The pure agent-loop + state machine + etc. are
 * unit-tested separately with fakes.
 *
 * SECURITY:
 *   - TAKE CONTROL is unconditional and P0. It:
 *     1. Sets the abort signal (the loop stops after the current step).
 *     2. Stops the BrowserActionService execution context.
 *     3. Transitions control state to HUMAN + latches takeover.
 *     4. Preserves all browser state (tabs, sessions, page) — NO destruction.
 */
import type {
  AgentRunRequest,
  AgentRunResult,
  AgentStateSnapshot,
  AgentStatusSnapshot,
  AgentTimelineEntry,
  BrowserActionPort,
  ControlMode,
  ControlModeUpdate,
  OllamaClientPort,
} from '@shared/agent-types';
import type { BrowserActionService } from '../../actions/runtime/browser-action-service';
import { AgentStateMachine } from '../pure/agent-state-machine';
import { runAgentLoop, type AbortSignal, type AgentLoopDeps } from '../pure/agent-loop';
import {
  DEFAULT_CONTROL_AUTHORIZATION,
  switchToAgent as authSwitchToAgent,
  takeControl as authTakeControl,
  clearTakeoverLatch as authClearTakeoverLatch,
  markAgentRunEnded,
  type ControlAuthorizationState,
} from '../pure/control-authorization';
import type { ActionInput, ActionResult } from '@shared/browser-actions-types';

// ---------------------------------------------------------------------------
// Callbacks (the IPC layer wires these to webContents.send)
// ---------------------------------------------------------------------------

export interface AgentControllerCallbacks {
  onStateChange?: (snapshot: AgentStateSnapshot) => void;
  onTimelineUpdate?: (entry: AgentTimelineEntry) => void;
  onControlModeChange?: (update: ControlModeUpdate) => void;
  onRunComplete?: (result: AgentRunResult) => void;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export interface AgentControllerDeps {
  ollama: OllamaClientPort;
  actions: BrowserActionService;
  callbacks?: AgentControllerCallbacks;
  /** Override Date.now for tests. */
  now?: () => number;
}

export class AgentController {
  private readonly stateMachine: AgentStateMachine;
  private control: ControlAuthorizationState = { ...DEFAULT_CONTROL_AUTHORIZATION };
  private timeline: AgentTimelineEntry[] = [];
  private abortSignal: AbortSignal = { aborted: false, reason: '' };
  private currentRun: Promise<AgentRunResult> | null = null;

  constructor(private deps: AgentControllerDeps) {
    this.stateMachine = new AgentStateMachine(deps.now ?? Date.now);
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  getStatus(): AgentStatusSnapshot {
    return {
      state: this.stateMachine.getState(),
      controlMode: this.control.mode,
      stepCount: this.stateMachine.snapshot().stepCount,
      maxSteps: 15, // TODO: expose from loop bounds
      startedAt: this.stateMachine.snapshot().startedAt,
      endedAt: this.stateMachine.snapshot().endedAt,
      reason: this.stateMachine.snapshot().reason,
      error: this.stateMachine.snapshot().error,
      providerConfigured: this.deps.ollama.isConfigured(),
      providerConfig: this.deps.ollama.isConfigured() ? this.deps.ollama.config : null,
    };
  }

  getTimeline(): AgentTimelineEntry[] {
    return [...this.timeline];
  }

  getControlMode(): ControlMode {
    return this.control.mode;
  }

  // ---------------------------------------------------------------------------
  // Control mode
  // ---------------------------------------------------------------------------

  /**
   * Switch to AGENT mode. Refuses if a run is currently active.
   */
  setMode(mode: ControlMode): { accepted: boolean; reason?: string } {
    if (mode === this.control.mode) {
      return { accepted: true };
    }
    if (mode === 'AGENT') {
      if (this.control.agentRunActive) {
        return { accepted: false, reason: 'agent_run_active' };
      }
      this.control = authSwitchToAgent(this.control);
      this.emitControlModeChange(false, 'user_request');
      return { accepted: true };
    }
    // mode === 'HUMAN' → TAKE CONTROL.
    return this.takeControl('user_request');
  }

  /**
   * TAKE CONTROL — P0.
   *
   * 1. Abort the current agent run (set abort signal).
   * 2. Stop the BrowserActionService execution context.
   * 3. Transition control state to HUMAN + latch takeover.
   * 4. Preserve all browser state (NO destruction).
   */
  takeControl(reason: string = 'user_request'): { accepted: boolean } {
    // 1. Abort the current run.
    this.abortSignal.aborted = true;
    this.abortSignal.reason = reason;

    // 2. Stop the execution context (the loop will also call this, but we
    //    do it here for defence-in-depth — if the loop is mid-step, this
    //    prevents the next action from dispatching).
    this.deps.actions.stopExecutionContext({ reason });

    // 3. Transition control state.
    this.control = authTakeControl(this.control, reason);

    // 4. Emit control mode change.
    this.emitControlModeChange(true, reason);

    return { accepted: true };
  }

  /**
   * Clear the takeover latch (after the user acknowledges).
   */
  clearTakeoverLatch(): void {
    this.control = authClearTakeoverLatch(this.control);
  }

  // ---------------------------------------------------------------------------
  // Agent run
  // ---------------------------------------------------------------------------

  /**
   * Start an agent run. Refuses if:
   *   - Not in AGENT mode.
   *   - A run is already active.
   *   - The Ollama provider is not configured.
   *
   * Returns the run's result promise. The caller can await it or subscribe
   * to the onRunComplete callback.
   */
  run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (this.control.mode !== 'AGENT') {
      return Promise.resolve({
        state: 'FAILED',
        answer: null,
        stepCount: 0,
        reason: 'not_in_agent_mode',
        error: 'Cannot start agent run in HUMAN mode',
      });
    }
    if (this.control.agentRunActive || this.currentRun) {
      return Promise.resolve({
        state: 'FAILED',
        answer: null,
        stepCount: 0,
        reason: 'run_already_active',
        error: 'An agent run is already active',
      });
    }
    if (!this.deps.ollama.isConfigured()) {
      // Honest UI: AI_PROVIDER_NOT_CONFIGURED — do NOT fake a response.
      this.stateMachine.start();
      this.stateMachine.markFailed('OLLAMA_NOT_CONFIGURED', 'provider_not_configured');
      this.emitStateChange();
      return Promise.resolve({
        state: 'FAILED',
        answer: null,
        stepCount: 0,
        reason: 'provider_not_configured',
        error: 'AI_PROVIDER_NOT_CONFIGURED',
      });
    }

    // Reset the abort signal for the new run.
    this.abortSignal = { aborted: false, reason: '' };

    // Clear the timeline for the new run.
    this.timeline = [];

    const loopDeps: AgentLoopDeps = {
      ollama: this.deps.ollama,
      actions: this.wrapActionService(this.deps.actions),
      control: this.control,
      onControlChange: (next) => {
        this.control = next;
      },
      onTimelineUpdate: (entry) => {
        this.timeline.push(entry);
        this.deps.callbacks?.onTimelineUpdate?.(entry);
      },
      onStateChange: (snapshot) => {
        this.deps.callbacks?.onStateChange?.(snapshot);
      },
      now: this.deps.now,
      maxSteps: request.maxSteps,
    };

    this.currentRun = runAgentLoop(loopDeps, request.command, this.abortSignal)
      .then((result) => {
        this.currentRun = null;
        this.deps.callbacks?.onRunComplete?.(result);
        return result;
      })
      .catch((err) => {
        this.currentRun = null;
        const result: AgentRunResult = {
          state: 'FAILED',
          answer: null,
          stepCount: 0,
          reason: 'uncaught_exception',
          error: safeErr(err),
        };
        this.deps.callbacks?.onRunComplete?.(result);
        return result;
      });

    return this.currentRun;
  }

  /**
   * Stop the current agent run (graceful). Sets the abort signal.
   */
  stop(reason: string = 'user_request'): { accepted: boolean } {
    if (!this.stateMachine.isActive()) {
      return { accepted: false };
    }
    this.abortSignal.aborted = true;
    this.abortSignal.reason = reason;
    return { accepted: true };
  }

  // ---------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.abortSignal.aborted = true;
    this.abortSignal.reason = 'controller_disposed';
    this.stateMachine.reset();
    this.control = { ...DEFAULT_CONTROL_AUTHORIZATION };
    this.timeline = [];
    this.currentRun = null;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Wrap the BrowserActionService into the BrowserActionPort interface.
   *
   * The service's `dispatch` method is generic (`ActionResult<ActionDataOf<K>>`);
   * the port expects `ActionResult<unknown>`. We bridge via a thin adapter
   * that calls the service and widens the result type.
   */
  private wrapActionService(service: BrowserActionService): BrowserActionPort {
    return {
      dispatch: async (input: ActionInput): Promise<ActionResult<unknown>> => {
        // The service's dispatch accepts any ActionInput variant and returns
        // a typed result; we widen to ActionResult<unknown> for the port.
        return service.dispatch(input) as Promise<ActionResult<unknown>>;
      },
      startExecutionContext: () => service.startExecutionContext(),
      stopExecutionContext: (opts?: { reason?: string }) =>
        service.stopExecutionContext(opts ?? {}),
    };
  }

  private emitStateChange(): void {
    this.deps.callbacks?.onStateChange?.(this.stateMachine.snapshot());
  }

  private emitControlModeChange(takeover: boolean, reason: string): void {
    this.deps.callbacks?.onControlModeChange?.({
      mode: this.control.mode,
      takeover,
      reason,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/\s+/g, ' ').slice(0, 200);
  }
  return String(err).slice(0, 200);
}
