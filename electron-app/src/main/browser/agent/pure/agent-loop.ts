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
  OllamaChatResponse,
  OllamaClientPort,
  ToolCall,
  ToolResult,
  ToolName,
} from '@shared/agent-types';
import { AGENT_LOOP_BOUNDS } from '@shared/agent-types';
import type { VaultPort } from '@shared/vault-types';

/** Runtime port for memory.save — proposes a fact for user confirmation. */
export interface MemoryPort {
  propose(fact: string): Promise<void>;
}
import type { ActionResult, PageSnapshot } from '@shared/browser-actions-types';
import { isVaultGenerateAllowed } from '../../incognito/pure/incognito-policy';
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
  /** Optional vault port for vault.* tool calls (PROMPT 6). */
  vault?: VaultPort;
  /**
   * Memory port for the memory.save tool — the implementation proposes the
   * fact to the USER (confirmation prompt); storage happens only on accept.
   */
  memory?: MemoryPort;
  /** Confirmed user facts injected into the system prompt. */
  memoryFacts?: string[];
  /**
   * Resolves the user's active tab for tab-scoped tools when the model
   * omits `tabId`. Without it, every tab-scoped call without an explicit
   * id fails validation and the model burns steps retrying.
   */
  resolveActiveTabId?: () => Promise<string | null>;
  /** Whether the current context is incognito (PROMPT 7). */
  incognitoContext?: boolean;
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
  /**
   * Optional profile instructions appended to the system prompt (PROMPT 9:
   * the DEEP_RESEARCH overlay). No other loop behavior changes.
   */
  systemPromptOverlay?: string;
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
  abortSignal: AbortSignal = { aborted: false, reason: '' },
  /** Base64 images attached to the initial user message (vision runs). */
  initialImages: string[] = []
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
    profileInstructions: deps.systemPromptOverlay,
    memoryFacts: deps.memoryFacts,
  });
  const history: OllamaChatMessage[] = [
    { role: 'system', content: systemPrompt },
    // Seeded vision attachments (e.g. New Tab image uploads) ride the
    // standard Ollama images channel — the non-vision fallback below
    // strips them if the model rejects image input.
    {
      role: 'user',
      content: command,
      ...(initialImages.length > 0 ? { images: initialImages } : {}),
    },
  ];

  let stepCount = 0;
  let parseErrors = 0;
  const MAX_PARSE_ERRORS = 3;
  let lastToolResult: ToolResult | null = null;

  // Emit the user_command as a timeline entry.
  pushTimeline(deps, () =>
    createEventTimelineEntry(0, 'user_command', truncate(command, 200), 'completed', now, command)
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
      let response: OllamaChatResponse;
      try {
        response = await deps.ollama.chat({
          model: deps.ollama.config.model,
          messages: history,
          tools: listToolsForRequest(),
          temperature: 0.2,
        });
      } catch (visionErr) {
        // Vision fallback: page.screenshot attached an image, but the
        // configured model is text-only (e.g. HTTP 400 "does not support
        // image input"). Retry once WITHOUT images so a text-only model
        // still completes the run instead of failing it.
        if (
          history.some((m) => (m.images?.length ?? 0) > 0) &&
          /image input|vision|multimodal|image/i.test(safeErr(visionErr))
        ) {
          const stripped: OllamaChatMessage[] = history.map((m) =>
            (m.images?.length ?? 0) > 0
              ? {
                  ...m,
                  images: undefined,
                  content: `${m.content}\n[note: the screenshot image could not be delivered — the configured model does not support vision input. Rely on browser.read instead.]`,
                }
              : m
          );
          response = await deps.ollama.chat({
            model: deps.ollama.config.model,
            messages: stripped,
            tools: listToolsForRequest(),
            temperature: 0.2,
          });
        } else {
          throw visionErr;
        }
      }
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
        createEventTimelineEntry(stepCount + 1, 'final_answer', truncate(modelOutput.answer, 200), 'completed', now, modelOutput.answer)
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

    // VALIDATE — schema + action validation. Tab-scoped tools fall back to
    // the resolved active tab when the model omits `tabId`.
    const activeTabId = (await deps.resolveActiveTabId?.()) ?? resolveActiveTabId(lastToolResult);
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

    // EXECUTE — dispatch through BrowserActionPort or VaultPort.
    pushTimeline(deps, () =>
      createToolTimelineEntry(stepCount, call, null, now, 'running')
    );

    let toolResult: ToolResult;
    if (tool === 'memory.save') {
      toolResult = await executeMemoryTool(deps, call);
    } else if (tool.startsWith('vault.')) {
      // Vault tools go through the VaultPort (not BrowserActionService).
      toolResult = await executeVaultTool(deps, call);
    } else {
      // Browser tools go through the BrowserActionPort.
      const actionResult = await deps.actions.dispatch(validation.actionInput!);
      toolResult = buildToolResult(tool, actionResult);
    }
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
      // Vision grounding: the screenshot rides along on the tool message
      // (Ollama images format). Keep the payload out of `content`.
      ...(toolResult.imageBase64
        ? { images: [toolResult.imageBase64] }
        : {}),
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
    'page.screenshot',
    'agent.stop',
    'vault.has',
    'vault.fill',
    'vault.generate_and_store',
    'memory.save',
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
    // The screenshot image is attached to the model message separately —
    // never duplicated into `data` (which could reach logs/timelines).
    const kind = (actionResult.data as { format?: string } | null)?.format;
    if (tool === 'page.screenshot' && kind === 'jpeg') {
      const shot = actionResult.data as { imageBase64?: string };
      if (shot.imageBase64) {
        result.imageBase64 = shot.imageBase64;
      }
      result.data = undefined;
    } else {
      result.data = actionResult.data;
    }
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
    case 'page.screenshot': {
      const data = actionResult.data as { width?: number; height?: number } | undefined;
      // The image itself is attached to the message, not the observation.
      return `screenshot captured (${data?.width ?? '?'}x${data?.height ?? '?'} JPEG image attached to this message)`;
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
// Vault tool execution — routes vault.* tools to VaultPort
// ---------------------------------------------------------------------------

async function executeMemoryTool(
  deps: AgentLoopDeps,
  call: ToolCall
): Promise<ToolResult> {
  const fact = String(call.args?.fact ?? '').trim();
  if (!fact) {
    return {
      tool: 'memory.save',
      success: false,
      observation: 'error:empty_fact',
      error: 'empty_fact',
    };
  }
  // Incognito runs never write memory — policy, not a failure of the task.
  if (deps.incognitoContext) {
    return {
      tool: 'memory.save',
      success: false,
      observation: 'memory is disabled in incognito; fact NOT stored',
      error: 'memory_disabled_incognito',
    };
  }
  if (!deps.memory) {
    return {
      tool: 'memory.save',
      success: false,
      observation: 'memory store unavailable',
      error: 'memory_unavailable',
    };
  }
  try {
    await deps.memory.propose(fact);
    return {
      tool: 'memory.save',
      success: true,
      observation:
        'fact proposed — the user has been asked to confirm; it is stored only after confirmation',
    };
  } catch (err) {
    return {
      tool: 'memory.save',
      success: false,
      observation: `error:${safeErr(err)}`,
      error: 'memory_propose_failed',
    };
  }
}

async function executeVaultTool(
  deps: AgentLoopDeps,
  call: ToolCall
): Promise<ToolResult> {
  if (!deps.vault) {
    return {
      tool: call.tool,
      success: false,
      observation: 'vault_not_configured',
      error: 'vault_not_configured',
    };
  }

  const args = call.args;
  try {
    switch (call.tool) {
      case 'vault.has': {
        const result = await deps.vault.has({ domain: String(args.domain ?? '') });
        return {
          tool: call.tool,
          success: true,
          observation: result.has
            ? `credential found for ${args.domain} (username: ${result.credential?.username ?? 'unknown'})`
            : `no credential found for ${args.domain}`,
          data: result,
        };
      }
      case 'vault.fill': {
        const tabId = String(args.tabId ?? '');
        const result = await deps.vault.fill({
          tabId,
          domain: String(args.domain ?? ''),
        });
        return {
          tool: call.tool,
          success: result.success,
          observation: result.success
            ? `filled credentials for ${result.matchedDomain ?? args.domain} (user:${result.usernameFilled ? '✓' : '✗'}, pass:${result.passwordFilled ? '✓' : '✗'})`
            : `fill failed: ${result.error ?? 'unknown'}`,
          data: result,
        };
      }
      case 'vault.generate_and_store': {
        // PROMPT 7: Deny vault.generate_and_store in incognito context.
        if (deps.incognitoContext && !isVaultGenerateAllowed(true)) {
          return {
            tool: call.tool,
            success: false,
            observation: 'vault.generate_and_store denied in incognito context',
            error: 'incognito_vault_generate_denied',
          };
        }
        const result = await deps.vault.generateAndStore({
          domain: String(args.domain ?? ''),
          username: String(args.username ?? ''),
        });
        return {
          tool: call.tool,
          success: result.success,
          observation: result.success
            ? `credential ${result.created ? 'created' : 'updated'} for ${args.domain} (username: ${result.credential?.username ?? 'unknown'})`
            : `generate failed: ${result.error ?? 'unknown'}`,
          data: result,
        };
      }
      default:
        return {
          tool: call.tool,
          success: false,
          observation: `unknown_vault_tool:${call.tool}`,
          error: 'unknown_vault_tool',
        };
    }
  } catch (err) {
    return {
      tool: call.tool,
      success: false,
      observation: `vault_error:${safeErr(err)}`,
      error: 'vault_error',
    };
  }
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
