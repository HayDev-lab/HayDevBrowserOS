/**
 * Agent loop — pure logic.
 *
 * Implements the OBSERVE → DECIDE → ONE ACTION → VERIFY → OBSERVE cycle.
 *
 *   1. OBSERVE: read the active page (or the page the model asked about).
 *   2. DECIDE: call the model with the current conversation history.
 *   3. PARSE: parse the model output (tool_call | final_answer | parse_error).
 *   4. VALIDATE: validate the tool call against the registry + authorization.
 *   5. EXECUTE: dispatch ONE action through BrowserActionPort.
 *   6. VERIFY: build the observation from the result, append to history.
 *   7. Repeat until: final_answer | max_steps | abort | timeout | parse_error limit.
 *
 * The loop is a pure function that takes injectable ports:
 *   - `ollama: OllamaClientPort` (production or fake)
 *   - `actions: BrowserActionPort` (the BrowserActionService or a fake)
 *   - `control: ControlAuthorizationState` (mutable via callbacks)
 *
 * NO electron import. Fully unit-testable with fakes.
 *
 * SECURITY:
 *   - The loop NEVER passes the API key to the model.
 *   - The loop NEVER includes page text in the timeline (only safe summaries).
 *   - The loop checks authorization BEFORE every tool dispatch.
 *   - On TAKE CONTROL (abort signal), the loop stops after the current step
 *     and transitions to STOPPED.
 */
import type {
  AgentRunResult,
  AgentTimelineEntry,
  BrowserActionPort,
  ModelOutput,
  OllamaChatMessage,
  OllamaClientPort,
  ToolCall,
  ToolResult,
  ToolName,
} from '@shared/agent-types';
import { AGENT_LOOP_BOUNDS } from '@shared/agent-types';
import type { ActionResult, PageSnapshot } from '@shared/browser-actions-types';
import { AgentStateMachine } from './agent-state-machine';
import {
  authorizeToolCall,
  takeControl as authTakeControl,
  markAgentRunStarted,
  markAgentRunEnded,
  type ControlAuthorizationState,
} from './control-authorization';
import { validateToolCall } from './tool-validator';
import { buildToolDescriptionsBlock } from './tool-registry';
import { parseModelOutput, buildSystemPrompt } from './ollama-response-parser';
import {
  createTimelineEntry,
  createEventTimelineEntry,
} from './timeline-redactor';

// ---------------------------------------------------------------------------
// Loop dependencies (injected)
// ---------------------------------------------------------------------------

export interface AgentLoopDeps {
  ollama: OllamaClientPort;
  actions: BrowserActionPort;
  /** Initial control state (HUMAN or AGENT). */
  control: ControlAuthorizationState;
  /** Callback when control state changes (for the controller to sync). */
  onControlChange?: (state: ControlAuthorizationState) => void;
  /** Callback when a timeline entry is added/updated. */
  onTimelineUpdate?: (entry: AgentTimelineEntry) => void;
  /** Callback when the agent state changes (for the controller to sync). */
  onStateChange?: (snapshot: import('@shared/agent-types').AgentStateSnapshot) => void;
  /** Override Date.now for tests. */
  now?: () => number;
  /** Max steps (clamped to HARD_MAX_STEPS). */
  maxSteps?: number;
  /** Timeout in ms (clamped to HARD_TIMEOUT_MS). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Abort signal — the controller sets this on TAKE CONTROL
// ---------------------------------------------------------------------------

export interface AbortSignal {
  aborted: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

export async function runAgentLoop(
  deps: AgentLoopDeps,
  command: string,
  abortSignal: AbortSignal = { aborted: false, reason: '' }
): Promise<AgentRunResult> {
  const maxSteps = clamp(
    deps.maxSteps ?? AGENT_LOOP_BOUNDS.DEFAULT_MAX_STEPS,
    1,
    AGENT_LOOP_BOUNDS.HARD_MAX_STEPS
  );
  const timeoutMs = clamp(
    deps.timeoutMs ?? AGENT_LOOP_BOUNDS.DEFAULT_TIMEOUT_MS,
    1000,
    AGENT_LOOP_BOUNDS.HARD_TIMEOUT_MS
  );
  const now = deps.now ?? Date.now;
  const startTime = now();

  const stateMachine = new AgentStateMachine(now);
  let control = deps.control;
  const emitControl = (next: ControlAuthorizationState) => {
    control = next;
    deps.onControlChange?.(next);
  };

  // Refuse to start in HUMAN mode.
  if (control.mode !== 'AGENT') {
    return {
      state: 'FAILED',
      answer: null,
      stepCount: 0,
      reason: 'not_in_agent_mode',
      error: 'Cannot start agent run in HUMAN mode',
    };
  }

  // Start the state machine.
  const runId = stateMachine.start();
  if (!runId) {
    return {
      state: 'FAILED',
      answer: null,
      stepCount: 0,
      reason: 'state_machine_refused_start',
      error: 'Agent state machine refused to start (already running?)',
    };
  }

  // Mark the agent run as active in the control state.
  emitControl(markAgentRunStarted(control));

  // Start the BrowserActionService execution context.
  const executionId = deps.actions.startExecutionContext();
  deps.onStateChange?.(stateMachine.snapshot());

  // Build the conversation history.
  const toolDescriptions = buildToolDescriptionsBlock();
  const systemPrompt = buildSystemPrompt({
    toolDescriptions,
    maxSteps,
  });
  const history: OllamaChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: command },
  ];

  let stepCount = 0;
  let parseErrors = 0;
  const MAX_PARSE_ERRORS = 3;
  let lastToolResult: ToolResult | null = null;

  // Emit the user_command as a timeline entry.
  pushTimeline(deps, () =>
    createEventTimelineEntry(0, 'user_command', truncate(command, 200), 'completed', now)
  );

  // Main loop.
  while (stepCount < maxSteps) {
    // Check abort signal (TAKE CONTROL).
    if (abortSignal.aborted) {
      return abortRun(deps, stateMachine, control, emitControl, abortSignal.reason, stepCount, now);
    }

    // Check timeout.
    if (now() - startTime > timeoutMs) {
      return failRun(
        deps,
        stateMachine,
        control,
        emitControl,
        'timeout',
        stepCount,
        `Run exceeded ${timeoutMs}ms timeout`,
        now
      );
    }

    // Check we're still in AGENT mode (the user might have taken control
    // asynchronously).
    if (control.mode !== 'AGENT' || control.takeoverLatched) {
      return abortRun(deps, stateMachine, control, emitControl, 'takeover', stepCount, now);
    }

    // DECIDE — call the model.
    let modelOutput: ModelOutput;
    try {
      const response = await deps.ollama.chat({
        model: deps.ollama.config.model,
        messages: history,
        tools: listToolsForRequest(),
        temperature: 0.2,
      });
      modelOutput = parseModelOutput(response.content);
    } catch (err) {
      return failRun(
        deps,
        stateMachine,
        control,
        emitControl,
        'ollama_error',
        stepCount,
        `Ollama call failed: ${safeErr(err)}`,
        now
      );
    }

    // Handle parse errors.
    if (modelOutput.kind === 'parse_error') {
      parseErrors += 1;
      pushTimeline(deps, () =>
        createEventTimelineEntry(stepCount + 1, 'parse_error', modelOutput.reason, 'failed', now)
      );
      if (parseErrors >= MAX_PARSE_ERRORS) {
        return failRun(
          deps,
          stateMachine,
          control,
          emitControl,
          'too_many_parse_errors',
          stepCount,
          `Model output unparseable ${parseErrors} times (last reason: ${modelOutput.reason})`,
          now
        );
      }
      // Append a corrective system message and retry.
      history.push({
        role: 'assistant',
        content: modelOutput.raw,
      });
      history.push({
        role: 'system',
        content: `Your previous response could not be parsed as a tool call (${modelOutput.reason}). Please respond with a single JSON object: {"tool": "...", "args": {...}} or a plain-text final answer.`,
      });
      continue;
    }

    // Handle final answer.
    if (modelOutput.kind === 'final_answer') {
      pushTimeline(deps, () =>
        createEventTimelineEntry(stepCount + 1, 'final_answer', truncate(modelOutput.answer, 200), 'completed', now)
      );
      stateMachine.markCompleted('final_answer');
      emitControl(markAgentRunEnded(control));
      deps.actions.stopExecutionContext({ reason: 'completed' });
      deps.onStateChange?.(stateMachine.snapshot());
      return {
        state: 'COMPLETED',
        answer: modelOutput.answer,
        stepCount,
        reason: 'final_answer',
        error: null,
      };
    }

    // It's a tool call. Increment step count.
    stepCount = stateMachine.recordStep();
    if (stepCount < 0) {
      // State machine refused (e.g. aborted concurrently).
      return abortRun(deps, stateMachine, control, emitControl, 'state_refused_step', stepCount, now);
    }

    const call = modelOutput.call;
    const tool = call.tool;

    // AUTHORIZE — check HUMAN/AGENT boundary.
    const auth = authorizeToolCall(control, tool);
    if (!auth.allowed) {
      const deniedResult: ToolResult = {
        tool,
        success: false,
        observation: `denied:${auth.reason}`,
        error: auth.reason,
      };
      pushTimeline(deps, () =>
        createToolTimelineEntry(stepCount, call, deniedResult, now)
      );
      // Tell the model the call was denied.
      history.push({ role: 'assistant', content: JSON.stringify({ tool, args: call.args }) });
      history.push({
        role: 'tool',
        content: `Tool call denied: ${auth.reason}. You are in ${control.mode} mode.`,
      });
      // If denied due to takeover or HUMAN mode, abort.
      // (control.mode is AGENT here, but a concurrent TAKE CONTROL could have
      // flipped it — re-read defensively as a string.)
      if (auth.reason === 'takeover_latched' || (control.mode as string) === 'HUMAN') {
        return abortRun(deps, stateMachine, control, emitControl, auth.reason, stepCount, now);
      }
      continue;
    }

    // VALIDATE — schema + action validation.
    const activeTabId = resolveActiveTabId(lastToolResult);
    const validation = validateToolCall(call, activeTabId);
    if (!validation.valid) {
      const invalidResult: ToolResult = {
        tool,
        success: false,
        observation: `invalid:${validation.errors.join(';')}`,
        error: 'invalid_tool_call',
      };
      pushTimeline(deps, () =>
        createToolTimelineEntry(stepCount, call, invalidResult, now)
      );
      history.push({ role: 'assistant', content: JSON.stringify({ tool, args: call.args }) });
      history.push({
        role: 'tool',
        content: `Tool call invalid: ${validation.errors.join('; ')}. Check the parameter types and required fields.`,
      });
      continue;
    }

    // EXECUTE — dispatch through BrowserActionPort.
    pushTimeline(deps, () =>
      createToolTimelineEntry(stepCount, call, null, now, 'running')
    );
    const actionResult = await deps.actions.dispatch(validation.actionInput!);

    // VERIFY — build the observation.
    const toolResult = buildToolResult(tool, actionResult);
    lastToolResult = toolResult;

    // Update the timeline entry with the result state + summary.
    pushTimeline(deps, () =>
      createToolTimelineEntry(stepCount, call, toolResult, now)
    );

    // Handle agent.stop tool.
    if (tool === 'agent.stop' && toolResult.success) {
      stateMachine.stop(call.args.reason as string ?? 'agent_stop_tool');
      stateMachine.markStopped('agent_stop_tool');
      emitControl(markAgentRunEnded(control));
      deps.actions.stopExecutionContext({ reason: 'agent_stop_tool' });
      deps.onStateChange?.(stateMachine.snapshot());
      return {
        state: 'STOPPED',
        answer: null,
        stepCount,
        reason: 'agent_stop_tool',
        error: null,
      };
    }

    // Append to history for the next model call.
    history.push({
      role: 'assistant',
      content: JSON.stringify({ tool, args: sanitizeArgsForHistory(call) }),
    });
    history.push({
      role: 'tool',
      content: toolResult.observation,
    });
  }

  // Max steps reached.
  pushTimeline(deps, () =>
    createEventTimelineEntry(stepCount, 'max_steps', `Reached max steps (${maxSteps})`, 'failed', now)
  );
  stateMachine.markFailed(`max_steps_reached:${maxSteps}`, 'max_steps');
  emitControl(markAgentRunEnded(control));
  deps.actions.stopExecutionContext({ reason: 'max_steps' });
  deps.onStateChange?.(stateMachine.snapshot());
  return {
    state: 'FAILED',
    answer: null,
    stepCount,
    reason: 'max_steps_reached',
    error: `Reached max steps (${maxSteps})`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function safeErr(err: unknown): string {
  if (err instanceof Error) return err.message.replace(/\s+/g, ' ').slice(0, 200);
  return String(err).slice(0, 200);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return '…';
  return s.slice(0, max - 1) + '…';
}

function listToolsForRequest(): ToolName[] {
  // The full list — the model picks one.
  return [
    'browser.navigate',
    'browser.read',
    'tabs.list',
    'tabs.open',
    'tabs.activate',
    'tabs.close',
    'page.click',
    'page.type',
    'page.scroll',
    'agent.stop',
  ];
}

function pushTimeline(
  deps: AgentLoopDeps,
  factory: () => AgentTimelineEntry
): void {
  const entry = factory();
  deps.onTimelineUpdate?.(entry);
}

function createToolTimelineEntry(
  step: number,
  call: ToolCall,
  result: ToolResult | null,
  now: () => number,
  state: 'running' | 'completed' | 'failed' | 'aborted' = result?.success ? 'completed' : 'failed'
): AgentTimelineEntry {
  return createTimelineEntry({
    step,
    tool: call.tool,
    args: call.args,
    result,
    state,
    now,
  });
}

function resolveActiveTabId(lastResult: ToolResult | null): string | null {
  // The agent loop doesn't have direct access to BrowserCore; it relies on
  // the BrowserActionPort to resolve "active tab" itself. We pass null and
  // let the action service / router handle it. (V1: action-validator
  // requires explicit tabId, so the model MUST provide one OR the controller
  // resolves it before the loop — for V1 simplicity, the model must provide
  // a tabId for tab-scoped tools.)
  void lastResult;
  return null;
}

function buildToolResult(
  tool: ToolName,
  actionResult: ActionResult<unknown>
): ToolResult {
  const success = actionResult.success;
  const observation = buildObservation(tool, actionResult);
  const result: ToolResult = {
    tool,
    success,
    observation,
  };
  if (!success && actionResult.error) {
    result.error = actionResult.error;
  }
  if (actionResult.data !== undefined) {
    result.data = actionResult.data;
  }
  // Detect password field for page.type.
  if (tool === 'page.type' && success) {
    const data = actionResult.data as { wasPasswordField?: boolean } | undefined;
    if (data?.wasPasswordField) {
      result.wasPasswordField = true;
      // The observation already excludes the typed text (buildSafeSummary
      // redacts it). But we also overwrite the observation to be explicit.
      result.observation = `typed into password field (${redactedMarker})`;
    }
  }
  return result;
}

function buildObservation(
  tool: ToolName,
  actionResult: ActionResult<unknown>
): string {
  if (!actionResult.success) {
    return `error:${actionResult.error ?? 'unknown'} (${truncate(actionResult.evidence ?? '', 100)})`;
  }
  switch (tool) {
    case 'browser.navigate': {
      const data = actionResult.data as { url?: string; navigationStarted?: boolean } | undefined;
      return `navigated to ${data?.url ?? 'unknown'}`;
    }
    case 'browser.read': {
      const snap = actionResult.data as PageSnapshot | undefined;
      if (!snap) return 'read page (no data)';
      return `read page: ${snap.url} (${snap.interactiveElements.length} elements, ${snap.textTruncated ? 'text truncated' : 'full text'})`;
    }
    case 'tabs.list': {
      const data = actionResult.data as { tabs?: unknown[] } | undefined;
      return `listed ${data?.tabs?.length ?? 0} tabs`;
    }
    case 'tabs.open': {
      const data = actionResult.data as { tabId?: string } | undefined;
      return `opened tab ${data?.tabId ?? ''}`;
    }
    case 'tabs.activate':
      return `activated tab`;
    case 'tabs.close':
      return `closed tab`;
    case 'page.click': {
      const data = actionResult.data as { elementId?: string; dispatched?: boolean } | undefined;
      return `clicked ${data?.elementId ?? ''} (dispatched: ${data?.dispatched ?? false})`;
    }
    case 'page.type': {
      const data = actionResult.data as { elementId?: string; charactersTyped?: number; wasPasswordField?: boolean } | undefined;
      if (data?.wasPasswordField) {
        return `typed into password field ${data?.elementId ?? ''} (${redactedMarker})`;
      }
      return `typed ${data?.charactersTyped ?? 0} chars into ${data?.elementId ?? ''}`;
    }
    case 'page.scroll': {
      const data = actionResult.data as { direction?: string; amount?: number } | undefined;
      return `scrolled ${data?.direction ?? ''} ${data?.amount ?? 0}px`;
    }
    case 'agent.stop':
      return 'stop requested';
    default:
      return 'completed';
  }
}

const redactedMarker = '<redacted>';

/**
 * Sanitize tool args before storing in conversation history.
 * Strips the `text` field from page.type calls (defense in depth — even
 * though the model produced the text, we don't want it echoed back in
 * subsequent observations in a way that could leak to the timeline).
 *
 * Note: the model DOES see its own args in the assistant message — this is
 * necessary for it to understand the conversation. But the `text` is
 * replaced with a placeholder so it doesn't appear in logs/timelines that
 * capture the full history.
 */
function sanitizeArgsForHistory(call: ToolCall): Record<string, unknown> {
  if (call.tool === 'page.type') {
    const { text, ...rest } = call.args;
    void text;
    return { ...rest, text: '<redacted>' };
  }
  return call.args;
}

// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------

function abortRun(
  deps: AgentLoopDeps,
  stateMachine: AgentStateMachine,
  control: ControlAuthorizationState,
  emitControl: (next: ControlAuthorizationState) => void,
  reason: string,
  stepCount: number,
  now: () => number
): AgentRunResult {
  stateMachine.stop(reason);
  stateMachine.markStopped(reason);
  // TAKE CONTROL: transition to HUMAN + latch.
  const afterTakeover = authTakeControl(control, reason);
  emitControl(afterTakeover);
  // Stop the execution context.
  deps.actions.stopExecutionContext({ reason });
  // Mark the run as ended — use the post-takeover state (HUMAN) so we don't
  // revert the mode back to AGENT.
  emitControl(markAgentRunEnded(afterTakeover));
  deps.onStateChange?.(stateMachine.snapshot());
  pushTimeline(deps, () =>
    createEventTimelineEntry(stepCount, 'abort', `Aborted: ${reason}`, 'aborted', now)
  );
  return {
    state: 'STOPPED',
    answer: null,
    stepCount,
    reason,
    error: null,
  };
}

function failRun(
  deps: AgentLoopDeps,
  stateMachine: AgentStateMachine,
  control: ControlAuthorizationState,
  emitControl: (next: ControlAuthorizationState) => void,
  reason: string,
  stepCount: number,
  error: string,
  now: () => number
): AgentRunResult {
  stateMachine.markFailed(error, reason);
  emitControl(markAgentRunEnded(control));
  deps.actions.stopExecutionContext({ reason });
  deps.onStateChange?.(stateMachine.snapshot());
  pushTimeline(deps, () =>
    createEventTimelineEntry(stepCount, 'error', `${reason}: ${truncate(error, 100)}`, 'failed', now)
  );
  return {
    state: 'FAILED',
    answer: null,
    stepCount,
    reason,
    error,
  };
}
