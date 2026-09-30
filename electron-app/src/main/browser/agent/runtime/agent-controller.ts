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
import { AGENT_LOOP_BOUNDS, AGENT_RUN_MAX_IMAGES } from '@shared/agent-types';
import type { VaultPort } from '@shared/vault-types';
import type { ResearchReport } from '@shared/research-types';
import { RESEARCH_BOUNDS } from '@shared/research-types';
import type { BrowserActionService } from '../../actions/runtime/browser-action-service';
import { AgentStateMachine } from '../pure/agent-state-machine';
import { runAgentLoop, type AbortSignal, type AgentLoopDeps } from '../pure/agent-loop';
import { getOverlayLabelForTool } from '../pure/overlay-labels';
import type { MemoryStore } from '../pure/memory-store';
import type { MemoryPromptUpdate, MemorySavePrompt } from '@shared/memory-types';
import { ResearchSession } from '../../research/runtime/research-session';
import { validateResearchQuery } from '../../research/pure/research-query';
import {
  DEFAULT_CONTROL_AUTHORIZATION,
  switchToAgent as authSwitchToAgent,
  takeControl as authTakeControl,
  clearTakeoverLatch as authClearTakeoverLatch,
  markAgentRunEnded,
  type ControlAuthorizationState,
} from '../pure/control-authorization';
import {
  shouldPersistAgentTimeline,
  isVaultGenerateAllowed,
} from '../../incognito/pure/incognito-policy';
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
  /**
   * Model override for DEEP_RESEARCH runs (e.g. a heavier model than the
   * STANDARD profile's). Undefined → every run uses ollama.config.model.
   */
  deepResearchModel?: string;
  actions: BrowserActionService;
  /** Optional vault port for vault.* agent tools (PROMPT 6). */
  vault?: VaultPort;
  /** Optional in-page status plaque shown while a run is active. */
  overlay?: AgentOverlayPort;
  /**
   * Confirmed-facts store. When present, memory.save is enabled: proposed
   * facts surface to the user as a confirmation prompt via pushMemoryPrompt.
   */
  memory?: MemoryStore;
  /** Push a memory confirmation prompt to the chrome renderer (or clear). */
  pushMemoryPrompt?: (update: import('@shared/memory-types').MemoryPromptUpdate) => void;
  callbacks?: AgentControllerCallbacks;
  /** Override Date.now for tests. */
  now?: () => number;
}

/** Status plaque port — implemented by AgentOverlay; mocked in tests. */
export interface AgentOverlayPort {
  /** Track a tab so hide() can clean it up even after navigation. */
  track(tabId: string): void;
  /** Show/refresh the plaque label on the tab the agent acts on. */
  update(tabId: string, label: string): void;
  /** Remove every tracked plaque. */
  hide(): void;
}

/**
 * Derive a port whose config.model is overridden. The loop reads
 * `deps.ollama.config.model` for every chat call, so this is the single
 * switch point for per-profile models (DEEP_RESEARCH). Everything else is
 * delegated — the underlying client keeps reading its own credential.
 */
function withModelOverride(port: OllamaClientPort, model: string): OllamaClientPort {
  return {
    config: { ...port.config, model },
    isConfigured: () => port.isConfigured(),
    chat: (request) => port.chat(request),
  };
}

export class AgentController {
  private readonly stateMachine: AgentStateMachine;
  private control: ControlAuthorizationState = { ...DEFAULT_CONTROL_AUTHORIZATION };
  private timeline: AgentTimelineEntry[] = [];
  private abortSignal: AbortSignal = { aborted: false, reason: '' };
  private currentRun: Promise<AgentRunResult> | null = null;
  private incognitoContext: boolean = false;
  /** Active research session (only while a DEEP_RESEARCH run is active). */
  private researchSession: ResearchSession | null = null;
  /** Last research report (in-memory only — never persisted in V1). */
  private lastResearchReport: ResearchReport | null = null;

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
      maxSteps: AGENT_LOOP_BOUNDS.DEFAULT_MAX_STEPS,
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

  /**
   * Set the incognito context for the controller.
   *
   * When set to true:
   *   - Agent timeline is NOT persisted (in-memory only, cleared on context end)
   *   - vault.generate_and_store is DENIED (agent cannot create new credentials)
   *   - vault.fill and vault.has remain ALLOWED (using existing trusted store)
   *
   * PROMPT 7: Incognito privacy policy enforcement.
   */
  setIncognitoContext(isIncognito: boolean): void {
    const wasIncognito = this.incognitoContext;
    this.incognitoContext = isIncognito;
    // If transitioning OUT of incognito, clear the private timeline and any
    // private research evidence (PROMPT 7 + PROMPT 9 privacy policy).
    if (wasIncognito && !isIncognito) {
      this.clearPrivateTimeline();
      this.clearResearchState();
    }
  }

  /**
   * Clear the in-memory timeline.
   *
   * Called when:
   *   - The incognito context ends (private timeline must be discarded).
   *   - A new run starts (timeline is cleared for the new run).
   *
   * This ensures private agent task history does NOT persist after the
   * private context is closed.
   */
  clearPrivateTimeline(): void {
    this.timeline = [];
  }

  /**
   * Whether the current context is incognito.
   */
  isIncognitoContext(): boolean {
    return this.incognitoContext;
  }

  /**
   * Clear in-memory research state (the ledger lives inside the session and
   * is dropped with it; the stored report is discarded). Used on private
   * context cleanup and disposal — no persistent research history in V1.
   */
  clearResearchState(): void {
    this.lastResearchReport = null;
    this.researchSession = null;
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

    // DEEP_RESEARCH profile (PROMPT 9): same loop, same services — plus a
    // deterministic recording session and the research prompt overlay.
    let researchSession: ResearchSession | null = null;
    if (request.profile === 'DEEP_RESEARCH') {
      const query = validateResearchQuery(request.command);
      if (!query.valid) {
        this.stateMachine.start();
        this.stateMachine.markFailed('INVALID_RESEARCH_QUERY', query.reason ?? 'invalid_query');
        this.emitStateChange();
        return Promise.resolve({
          state: 'FAILED',
          answer: null,
          stepCount: 0,
          reason: 'invalid_research_query',
          error: `Invalid research query: ${query.reason ?? 'invalid'}`,
        });
      }
      researchSession = new ResearchSession();
      this.researchSession = researchSession;
    }

    const basePort = this.wrapActionService(this.deps.actions);
    const actionsPort = researchSession
      ? researchSession.recordingPort(basePort, this.deps.now ?? Date.now)
      : basePort;

    // In-page status plaque: show immediately on the active tab (the model
    // may think for seconds before its first tool call).
    void (async () => {
      try {
        const listed = await this.deps.actions.listTabs();
        if (!listed.success || !listed.data) return;
        const tabId =
          listed.data.tabs.find((t) => t.isActive)?.id ??
          listed.data.tabs[0]?.id;
        if (tabId) {
          this.deps.overlay?.track(tabId);
          this.deps.overlay?.update(tabId, 'Thinking');
        }
      } catch {
        // Cosmetic — never block a run on the plaque.
      }
    })();

    // Per-profile model: DEEP_RESEARCH runs on the heavier research model
    // (deps.deepResearchModel) when configured; STANDARD keeps the default.
    const ollamaPort =
      request.profile === 'DEEP_RESEARCH' && this.deps.deepResearchModel
        ? withModelOverride(this.deps.ollama, this.deps.deepResearchModel)
        : this.deps.ollama;

    const loopDeps: AgentLoopDeps = {
      ollama: ollamaPort,
      actions: actionsPort,
      resolveActiveTabId: async () => {
        // Best-effort: the active tab for the model's tab-scoped calls.
        try {
          const listed = await this.deps.actions.listTabs();
          if (!listed.success || !listed.data) return null;
          return (
            listed.data.tabs.find((t) => t.isActive)?.id ??
            listed.data.tabs[0]?.id ??
            null
          );
        } catch {
          return null;
        }
      },
      vault: this.deps.vault,
      memory: this.deps.memory
        ? {
            propose: (fact) => this.proposeMemoryFact(fact),
          }
        : undefined,
      memoryFacts: this.deps.memory?.factTexts(50) ?? [],
      incognitoContext: this.incognitoContext,
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
      maxSteps: request.maxSteps ?? (researchSession ? RESEARCH_BOUNDS.DEFAULT_MAX_STEPS : undefined),
      timeoutMs: researchSession ? RESEARCH_BOUNDS.TIMEOUT_MS : undefined,
      systemPromptOverlay: researchSession?.promptOverlay(),
    };

    const session = researchSession;
    // Seeded vision attachments (New Tab image uploads) — bounded by the
    // shared run-request cap before they enter the loop.
    const seedImages = (request.images ?? []).slice(0, AGENT_RUN_MAX_IMAGES);
    this.currentRun = runAgentLoop(loopDeps, request.command, this.abortSignal, seedImages)
      .then((result) => {
        this.currentRun = null;
        this.deps.overlay?.hide();
        this.finishResearch(session, result);
        this.deps.callbacks?.onRunComplete?.(result);
        return result;
      })
      .catch((err) => {
        this.currentRun = null;
        this.deps.overlay?.hide();
        const result: AgentRunResult = {
          state: 'FAILED',
          answer: null,
          stepCount: 0,
          reason: 'uncaught_exception',
          error: safeErr(err),
        };
        this.finishResearch(session, result);
        this.deps.callbacks?.onRunComplete?.(result);
        return result;
      });

    return this.currentRun;
  }


  /**
   * memory.save execution: surface the proposed fact as a confirmation
   * prompt in the rail. Only the confirmed path writes to the store
   * (memory:prompt:resolve handler in main).
   */
  private pendingMemoryPrompt: MemorySavePrompt | null = null;

  private async proposeMemoryFact(fact: string): Promise<void> {
    this.pendingMemoryPrompt = {
      id: `mem_${(this.deps.now ?? Date.now)().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      fact: fact.slice(0, 300),
      createdAt: (this.deps.now ?? Date.now)(),
    };
    this.deps.pushMemoryPrompt?.({ kind: 'set', prompt: this.pendingMemoryPrompt });
  }

  /** Resolve the pending memory prompt (called by the IPC layer). */
  async resolveMemoryPrompt(promptId: string, save: boolean): Promise<{ success: boolean }> {
    const pending = this.pendingMemoryPrompt;
    this.pendingMemoryPrompt = null;
    this.deps.pushMemoryPrompt?.({ kind: 'clear' });
    if (!pending || pending.id !== promptId || !save) return { success: false };
    if (!this.deps.memory) return { success: false };
    await this.deps.memory.confirm(pending.fact);
    return { success: true };
  }

  /** Current pending memory prompt (for the renderer's initial fetch). */
  getMemoryPrompt(): MemorySavePrompt | null {
    return this.pendingMemoryPrompt;
  }

  /**
   * Build + store the research report after a DEEP_RESEARCH run settles —
   * including STOPPED/aborted runs, where the collected ledger becomes a
   * SAFE PARTIAL result (architecture allows it; nothing is discarded).
   */
  private finishResearch(session: ResearchSession | null, result: AgentRunResult): void {
    if (!session) return;
    const nowFn = this.deps.now ?? Date.now;
    this.lastResearchReport = session.buildReport(result, nowFn());
    this.researchSession = null;
  }

  /** Last research report (in-memory only; null before the first run). */
  getResearchReport(): ResearchReport | null {
    return this.lastResearchReport;
  }

  /** True while a DEEP_RESEARCH run is active. */
  isResearchRunning(): boolean {
    return this.researchSession !== null;
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
    this.clearResearchState();
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
        // In-page plaque follows the tab the agent acts on.
        const overlay = this.deps.overlay;
        if (overlay) {
          const tabId = 'tabId' in input ? (input.tabId as string | undefined) : undefined;
          if (tabId) {
            overlay.track(tabId);
            overlay.update(tabId, getOverlayLabelForTool(kindToToolName(input.kind)));
          }
        }
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

/** Map an action kind to its tool name for the overlay label lookup. */
function kindToToolName(kind: ActionInput['kind']): string {
  switch (kind) {
    case 'navigate': return 'browser.navigate';
    case 'readPage': return 'browser.read';
    case 'click': return 'page.click';
    case 'type': return 'page.type';
    case 'scroll': return 'page.scroll';
    case 'listTabs': return 'tabs.list';
    case 'openTab': return 'tabs.open';
    case 'activateTab': return 'tabs.activate';
    case 'closeTab': return 'tabs.close';
    case 'stop': return 'agent.stop';
    default: return kind;
  }
}
