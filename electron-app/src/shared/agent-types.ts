/**
 * Agent Runtime — typed contracts.
 *
 * Shared across:
 *   - Pure agent modules (state machine, loop, validators, redactor, parser).
 *   - Runtime modules (OllamaClient, AgentController).
 *   - IPC layer (main handlers + preload surface).
 *   - Renderer (agent-store hook).
 *
 * SECURITY:
 *   - All types are pure data (no Electron/Node objects).
 *   - Timeline entries NEVER carry password/credential values.
 *   - OllamaClientConfig never serializes the API key across IPC.
 *   - VaultPort does NOT include getPassword/decrypt (PROMPT 6).
 *
 * Pure data — no Electron imports.
 */
import type { VaultPort } from './vault-types';

// ---------------------------------------------------------------------------
// Control mode (runtime, NOT the renderer's local-deterministic visual state)
// ---------------------------------------------------------------------------
export type ControlMode = 'HUMAN' | 'AGENT';

// ---------------------------------------------------------------------------
// Agent state machine
// ---------------------------------------------------------------------------
export type AgentStateName =
  | 'IDLE'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'COMPLETED'
  | 'FAILED';

export interface AgentStateSnapshot {
  state: AgentStateName;
  /** Human-readable reason for the current state (e.g. 'user_request', 'max_steps_reached'). */
  reason: string | null;
  /** Number of steps executed in the current/last run. */
  stepCount: number;
  /** Epoch ms when the run started (if RUNNING/STOPPING/COMPLETED/FAILED). */
  startedAt: number | null;
  /** Epoch ms when the run ended (if STOPPED/COMPLETED/FAILED). */
  endedAt: number | null;
  /** Error message if state === 'FAILED'. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Tool calls — the model's request to execute a browser action
// ---------------------------------------------------------------------------

/**
 * The 10 tools exposed to the model. Names match the BrowserActionService
 * action kinds (with a `browser.` / `tabs.` / `page.` / `agent.` namespace
 * prefix for clarity in the model's output).
 */
export type ToolName =
  | 'browser.navigate'
  | 'browser.read'
  | 'tabs.list'
  | 'tabs.open'
  | 'tabs.activate'
  | 'tabs.close'
  | 'page.click'
  | 'page.type'
  | 'page.scroll'
  | 'page.screenshot'
  | 'agent.stop'
  | 'vault.has'
  | 'vault.fill'
  | 'vault.generate_and_store'
  | 'memory.save';

/**
 * A tool call from the model. The `args` shape depends on `tool` — see
 * `tool-validator.ts` for the per-tool schema. Args are passed through to
 * BrowserActionService after validation.
 */
export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
  /** Optional reasoning the model provided for this call. NEVER logged with secrets. */
  reasoning?: string;
}

/**
 * Result of executing a tool call. Mirrors ActionResult<T> from
 * BrowserActionService but flattened for the model's consumption.
 *
 * SECURITY:
 *   - `observation` is the safe summary shown to the model. Password values
 *     and credential text are NEVER included.
 *   - `wasPasswordField` is true if the action typed into a password field;
 *     in that case the typed text is NOT echoed in `observation`.
 */
export interface ToolResult {
  tool: ToolName;
  success: boolean;
  /** Safe observation summary for the model. ≤500 chars. No secrets. */
  observation: string;
  /** Structured data (e.g. PageSnapshot for browser.read). May be undefined. */
  data?: unknown;
  /** Error code if !success. */
  error?: string;
  /** True if the tool was `page.type` and the target was a password field. */
  wasPasswordField?: boolean;
  /**
   * Base64 JPEG of the captured viewport — `page.screenshot` only. Attached
   * to the next model message as a vision input; NEVER stored in the
   * timeline or logs.
   */
  imageBase64?: string;
}

// ---------------------------------------------------------------------------
// Model output — what the OllamaClient returns
// ---------------------------------------------------------------------------

/**
 * Parsed model output. Either:
 *   - `final_answer` — the model is done; return the answer to the user.
 *   - `tool_call` — the model wants to execute one tool.
 *   - `parse_error` — the model output was unparseable.
 */
export type ModelOutput =
  | { kind: 'final_answer'; answer: string }
  | { kind: 'tool_call'; call: ToolCall }
  | { kind: 'parse_error'; raw: string; reason: string };

// ---------------------------------------------------------------------------
// Ollama client — interface for production + fake
// ---------------------------------------------------------------------------

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /**
   * Base64-encoded images attached to this message (Ollama vision format,
   * no data-URI prefix). Used by `page.screenshot` to ground the model.
   */
  images?: string[];
}

export interface OllamaChatRequest {
  /** The model name (e.g. 'llama3.1', 'qwen2.5'). */
  model: string;
  messages: OllamaChatMessage[];
  /** If true, request tool-calling format. V1 uses plain text + JSON parsing. */
  tools?: ToolName[];
  /** Temperature. Default 0.2 for deterministic agent behaviour. */
  temperature?: number;
}

export interface OllamaChatResponse {
  /** The model's textual output. May contain a JSON tool-call block. */
  content: string;
  /** Token usage if reported by the API. */
  totalTokens?: number;
}

export interface OllamaClientConfig {
  /** Base URL, e.g. 'https://api.example.com' (no trailing slash). */
  baseUrl: string;
  /** Model name, e.g. 'llama3.1'. */
  model: string;
  /**
   * Credential reference — an opaque string identifying where the API key
   * comes from (e.g. 'env:OLLAMA_API_KEY'). The actual key is NEVER stored
   * in this config object; the runtime OllamaClient reads it from the
   * environment at call time.
   */
  credentialRef: string;
}

export interface OllamaClientPort {
  /** Configuration (without the actual API key). */
  config: OllamaClientConfig;
  /** True if the client has a usable credential. */
  isConfigured(): boolean;
  /** Send a chat request. Throws on network/auth failure. */
  chat(request: OllamaChatRequest): Promise<OllamaChatResponse>;
}

// ---------------------------------------------------------------------------
// BrowserActionService port — minimal interface consumed by the agent loop
// ---------------------------------------------------------------------------

/**
 * The agent loop calls this interface, NOT the concrete BrowserActionService.
 * This allows unit tests to inject a fake.
 *
 * The interface mirrors `BrowserActionService.dispatch` but accepts a
 * discriminated union and returns the universal ActionResult.
 */
export interface BrowserActionPort {
  dispatch(input: import('./browser-actions-types').ActionInput): Promise<
    import('./browser-actions-types').ActionResult<unknown>
  >;
  startExecutionContext(): string;
  stopExecutionContext(opts?: { reason?: string }): {
    executionId: string;
    aborted: boolean;
    cancelledCount: number;
  };
}

// ---------------------------------------------------------------------------
// Agent timeline — for UI display
// ---------------------------------------------------------------------------

export type TimelineEntryState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted';

export interface AgentTimelineEntry {
  id: string;
  /** Step number within the run (1-indexed). */
  step: number;
  /** Tool name or 'user_command' / 'final_answer' / 'parse_error' / 'max_steps'. */
  kind: string;
  /** Safe target description (e.g. 'tab_1, el_0'). No secrets. */
  target: string;
  state: TimelineEntryState;
  /** Safe result summary (≤200 chars). No secrets. */
  summary: string;
  /**
   * Full untruncated text for chat-bearing entries (user_command,
   * final_answer). Used by the agent chat panel; never set for tool
   * entries (their summaries stay compact).
   */
  fullText?: string;
  /** Epoch ms. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// IPC payloads
// ---------------------------------------------------------------------------

export interface AgentRunRequest {
  /** User's natural-language command. */
  command: string;
  /** Optional max-step override (bounded by the loop's hard cap). */
  maxSteps?: number;
  /**
   * Execution profile (PROMPT 9). STANDARD = normal run; DEEP_RESEARCH =
   * research prompt overlay + deterministic source-ledger recording +
   * structured report completion. Same runtime either way.
   */
  profile?: import('./research-types').AgentRunProfile;
  /** Selected tab and durable session identity for poker profiles. */
  poker?: import('./poker-types').PokerConfig;
  /**
   * Base64 images (Ollama vision format) attached to the initial user
   * message — e.g. New Tab image uploads. Bounded by
   * AGENT_RUN_MAX_IMAGES; stripped automatically for non-vision models.
   */
  images?: string[];
  /**
   * Ids of pending attachments in the MAIN-process registry (picked via
   * the newtab/agent pickAttachment channels). Resolved to bounded text
   * digests + vision images before the loop starts.
   */
  attachmentIds?: string[];
}

/** Hard cap on run-request images (enforced by the controller). */
export const AGENT_RUN_MAX_IMAGES = 4;

export interface AgentStatusSnapshot {
  poker?: (import('./poker-types').PokerConfig & { mode: 'human' | 'auto' }) | null;
  state: AgentStateName;
  controlMode: ControlMode;
  stepCount: number;
  maxSteps: number;
  startedAt: number | null;
  endedAt: number | null;
  reason: string | null;
  error: string | null;
  /** True if the OllamaClient is configured (has credential). */
  providerConfigured: boolean;
  /** Provider config (without API key) for UI display. */
  providerConfig: OllamaClientConfig | null;
}

// ---------------------------------------------------------------------------
// Push event payloads (main → renderer via ipcRenderer.send)
// ---------------------------------------------------------------------------

export type AgentTimelineUpdate =
  | { kind: 'add'; entry: AgentTimelineEntry }
  | { kind: 'update'; id: string; state: TimelineEntryState; summary?: string }
  | { kind: 'clear' };

export interface ControlModeUpdate {
  mode: ControlMode;
  /** True if the change was triggered by TAKE CONTROL. */
  takeover: boolean;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Agent loop bounds (centralized)
// ---------------------------------------------------------------------------
export const AGENT_LOOP_BOUNDS = {
  /** Default max steps per run. */
  DEFAULT_MAX_STEPS: 15,
  /** Hard cap on max steps — user-provided maxSteps is clamped to this. */
  HARD_MAX_STEPS: 30,
  /** Default timeout per run, in ms. */
  DEFAULT_TIMEOUT_MS: 60_000,
  /** Hard cap on timeout. */
  HARD_TIMEOUT_MS: 300_000,
  /** Max observation text length sent to the model. */
  MAX_OBSERVATION_LENGTH: 500,
  /** Max timeline summary length. */
  MAX_SUMMARY_LENGTH: 200,
  /** Max full text length for chat entries (user_command / final_answer). */
  MAX_CHAT_TEXT: 4000,
} as const;

// ---------------------------------------------------------------------------
// Authorization decisions
// ---------------------------------------------------------------------------
export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

// ---------------------------------------------------------------------------
// Agent loop result
// ---------------------------------------------------------------------------

export interface AgentRunResult {
  state: AgentStateName;
  /** The final answer if state === 'COMPLETED'. */
  answer: string | null;
  /** Number of steps executed. */
  stepCount: number;
  /** Reason for the final state. */
  reason: string | null;
  /** Error if state === 'FAILED'. */
  error: string | null;
}
