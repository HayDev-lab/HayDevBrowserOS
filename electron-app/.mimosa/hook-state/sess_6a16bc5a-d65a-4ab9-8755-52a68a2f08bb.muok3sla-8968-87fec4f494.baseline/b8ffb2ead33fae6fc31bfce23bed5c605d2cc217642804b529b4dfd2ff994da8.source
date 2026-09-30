/**
 * Browser Action Service — typed contracts.
 *
 * These types are shared across:
 *   - The pure validation/routing/normalization layer (no electron import).
 *   - The runtime adapter (Electron-bound).
 *   - The orchestrator (BrowserActionService).
 *   - Future consumers: Internal Agent (PROMPT 5), MCP Server (PROMPT 8).
 *
 * SECURITY:
 *   - All result types MUST be serializable (no Node objects, no Electron
 *     objects, no functions).
 *   - PageSnapshot redacts password fields — never leaks plaintext credentials.
 *   - Action inputs are validated BEFORE reaching the runtime adapter.
 *
 * Pure data — no Electron imports.
 */

// ---------------------------------------------------------------------------
// ActionResult — the universal result contract
// ---------------------------------------------------------------------------

/**
 * Every action returns an `ActionResult`. Successes carry `data`; failures
 * carry `error` and (optionally) `evidence` explaining what happened.
 *
 * The `evidence` field is for diagnostics — it MUST NOT contain plaintext
 * secrets, full page HTML, or raw credentials. It is intended for short
 * human-readable context strings (e.g. "tab_not_found:tab_42",
 * "element_disabled:btn_submit") that future agents (LLM) can use to
 * decide their next step.
 */
export interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  evidence?: string;
  /** Execution context id this result belongs to. */
  executionId: string;
  /** Epoch ms when the action completed. */
  completedAt: number;
}

// ---------------------------------------------------------------------------
// Execution context — cancellation boundary
// ---------------------------------------------------------------------------

/**
 * An execution context groups a sequence of actions under a single
 * cancellation boundary. Each context has a stable id. `stop()` aborts the
 * current context; subsequent actions on the SAME context are rejected.
 * A new context can be started separately without affecting browser state.
 *
 * PROMPT 5 will map: HUMAN mode = no execution context active;
 * AGENT mode = one execution context active per agent run; TAKE CONTROL
 * = stop() the current context + refuse new actions on it.
 */
export type ExecutionContextStateName = 'idle' | 'running' | 'aborted';

export interface ExecutionContextSnapshot {
  id: string;
  state: ExecutionContextStateName;
  /** Number of actions dispatched in this context. */
  actionCount: number;
  /** Epoch ms when the context was created. */
  createdAt: number;
  /** Epoch ms when the context was aborted, if applicable. */
  abortedAt: number | null;
  /** Reason for abortion, if any. */
  abortReason: string | null;
}

// ---------------------------------------------------------------------------
// Action kinds — V1 minimal set
// ---------------------------------------------------------------------------

export type ActionKind =
  | 'navigate'
  | 'readPage'
  | 'listTabs'
  | 'openTab'
  | 'activateTab'
  | 'closeTab'
  | 'click'
  | 'type'
  | 'scroll'
  | 'stop';

// ---------------------------------------------------------------------------
// Action input contracts
// ---------------------------------------------------------------------------

export interface NavigateActionInput {
  kind: 'navigate';
  tabId: string;
  url: string;
}

export interface ReadPageActionInput {
  kind: 'readPage';
  tabId: string;
  /**
   * Maximum number of characters of visible text to return.
   * Default: 10 000. Hard cap: 50 000.
   */
  maxTextLength?: number;
  /**
   * Maximum number of interactive elements to return.
   * Default: 200. Hard cap: 1000.
   */
  maxElements?: number;
}

export interface ListTabsActionInput {
  kind: 'listTabs';
}

export interface OpenTabActionInput {
  kind: 'openTab';
  url?: string;
  activate?: boolean;
  incognito?: boolean;
}

export interface ActivateTabActionInput {
  kind: 'activateTab';
  tabId: string;
}

export interface CloseTabActionInput {
  kind: 'closeTab';
  tabId: string;
}

export interface ClickActionInput {
  kind: 'click';
  tabId: string;
  /** Stable id from a prior PageSnapshot.interactiveElements[].id */
  elementId: string;
}

export interface TypeActionInput {
  kind: 'type';
  tabId: string;
  /** Stable id from a prior PageSnapshot.interactiveElements[].id */
  elementId: string;
  /** Text to type. SECURITY: redacted from logs if target is a password field. */
  text: string;
  /** Clear the field before typing. Default: true. */
  clearFirst?: boolean;
}

export interface ScrollActionInput {
  kind: 'scroll';
  tabId: string;
  direction: 'up' | 'down' | 'left' | 'right';
  /**
   * Amount to scroll, in pixels. Default: 400.
   * Hard cap: 10 000.
   */
  amount?: number;
}

export interface ScreenshotActionInput {
  kind: 'screenshot';
  tabId: string;
  /**
   * Capture width cap (aspect preserved). Default: 1024.
   * Hard cap: 1600 — bounds both memory and model context.
   */
  maxWidth?: number;
}

export interface StopActionInput {
  kind: 'stop';
  /** Optional explicit execution context id to stop. Defaults to the active context. */
  executionId?: string;
  /** Reason for stopping. Default: 'user_request'. */
  reason?: string;
}

export type ActionInput =
  | NavigateActionInput
  | ReadPageActionInput
  | ListTabsActionInput
  | OpenTabActionInput
  | ActivateTabActionInput
  | CloseTabActionInput
  | ClickActionInput
  | TypeActionInput
  | ScrollActionInput
  | ScreenshotActionInput
  | StopActionInput;

// ---------------------------------------------------------------------------
// Action result data types
// ---------------------------------------------------------------------------

export interface NavigateResultData {
  tabId: string;
  /** URL actually loaded (may differ from input after redirects). */
  url: string;
  /** True if navigation was kicked off (loadURL was called). */
  navigationStarted: boolean;
}

export interface ListTabsResultData {
  tabs: import('./browser-types').TabState[];
}

export interface OpenTabResultData {
  tabId: string;
}

export interface ActivateTabResultData {
  tabId: string;
  activated: boolean;
}

export interface CloseTabResultData {
  tabId: string;
  closed: boolean;
}

export interface ClickResultData {
  tabId: string;
  elementId: string;
  /** True if the click was dispatched to the DOM. */
  dispatched: boolean;
}

export interface TypeResultData {
  tabId: string;
  elementId: string;
  /** Number of characters typed. */
  charactersTyped: number;
  /** True if the target was a password field (text is redacted from logs). */
  wasPasswordField: boolean;
}

export interface ScrollResultData {
  tabId: string;
  direction: string;
  amount: number;
  dispatched: boolean;
}

export interface ScreenshotResultData {
  tabId: string;
  /** Base64-encoded JPEG of the visible viewport. */
  imageBase64: string;
  width: number;
  height: number;
  format: 'jpeg';
}

export interface StopResultData {
  executionId: string;
  aborted: boolean;
  /** Number of in-flight actions that were cancelled. */
  cancelledCount: number;
}

// ---------------------------------------------------------------------------
// PageSnapshot — the LLM-friendly view of a page
// ---------------------------------------------------------------------------

/**
 * A snapshot of a page's visible state, suitable for LLM consumption.
 *
 * SECURITY:
 *   - Password field values are NEVER included. The `valueState` of a
 *     password input is always `'<redacted>'`.
 *   - File input values are never included (no path leakage).
 *   - `visibleText` is truncated to `maxTextLength` to bound LLM context.
 */
export interface PageSnapshot {
  /** Snapshot id — stable for the lifetime of this snapshot. */
  id: string;
  /** Tab id this snapshot belongs to. */
  tabId: string;
  /** Epoch ms when the snapshot was taken. */
  takenAt: number;
  url: string;
  title: string;
  /** Visible text on the page, truncated to maxTextLength. */
  visibleText: string;
  /** True if visibleText was truncated. */
  textTruncated: boolean;
  /** Interactive elements (links, buttons, inputs, selects, etc.). */
  interactiveElements: InteractiveElement[];
  /** Forms on the page. */
  forms: FormSnapshot[];
  /** Number of elements filtered out (e.g. hidden, off-screen). */
  filteredCount: number;
}

export type ElementRole =
  | 'link'
  | 'button'
  | 'input'
  | 'select'
  | 'textarea'
  | 'checkbox'
  | 'radio'
  | 'submit'
  | 'reset'
  | 'image'
  | 'other';

export interface InteractiveElement {
  /** Stable id within this snapshot. Format: `el_<index>` (e.g. `el_0`, `el_1`). */
  id: string;
  role: ElementRole;
  /** Accessible name or visible text label. */
  accessibleName: string;
  /** True if the element is disabled. */
  disabled: boolean;
  /** True if the element is hidden or off-screen. */
  hidden: boolean;
  /** Tag name, lowercased. */
  tagName: string;
  /** Optional href for links. */
  href?: string;
  /** For form controls: the input type. */
  inputType?: string;
  /** For form controls: placeholder text. */
  placeholder?: string;
  /**
   * For form controls: the current value state.
   * SECURITY: password fields always return `'<redacted>'`.
   * File inputs always return `'<file>'`.
   */
  valueState?: string;
  /** For checkboxes/radios: whether the element is checked. */
  checked?: boolean;
  /** For elements with a name attribute (form controls). */
  name?: string;
}

export interface FormSnapshot {
  /** Stable id within this snapshot. Format: `form_<index>`. */
  id: string;
  /** Form action URL, if any. */
  action?: string;
  /** Form method, if any. */
  method?: string;
  /** Form name, if any. */
  name?: string;
  /** Ids of interactive elements that belong to this form. */
  elementIds: string[];
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ---------------------------------------------------------------------------
// Runtime adapter interface (implemented by Electron-bound code)
// ---------------------------------------------------------------------------

/**
 * The runtime adapter abstracts the Electron-specific execution of actions
 * (click/type/scroll/readPage via `webContents.executeJavaScript`, navigate
 * via `webContents.loadURL`).
 *
 * The pure `ActionRouter` calls this interface; tests inject a `FakeAdapter`.
 * The real `WebContentsActionAdapter` lives in `runtime/`.
 *
 * SECURITY: The adapter MUST NOT accept arbitrary JS strings. Each method
 * corresponds to one typed action; the adapter constructs its own
 * executeJavaScript payload internally.
 */
export interface ActionRuntimeAdapter {
  /**
   * Navigate a tab to a URL. Returns the URL actually loaded (may differ
   * after redirects) or throws on failure.
   */
  navigate(tabId: string, url: string): Promise<string>;

  /**
   * Read the page snapshot data. Returns raw (un-normalized) data; the pure
   * `SnapshotNormalizer` then converts it to a `PageSnapshot`.
   */
  readPageRaw(
    tabId: string,
    opts: { maxTextLength: number; maxElements: number }
  ): Promise<RawPageData>;

  /**
   * Click an element by its snapshot-assigned stable id.
   * The adapter must resolve the id back to a DOM element using the same
   * indexing scheme as `readPageRaw`. Returns true if the click dispatched.
   */
  click(tabId: string, elementId: string): Promise<boolean>;

  /**
   * Type text into an editable element by its snapshot-assigned stable id.
   * Returns whether the target was a password field (for log redaction).
   */
  type(
    tabId: string,
    elementId: string,
    text: string,
    clearFirst: boolean
  ): Promise<{ charactersTyped: number; wasPasswordField: boolean }>;

  /**
   * Scroll the page in a direction by a pixel amount.
   */
  scroll(
    tabId: string,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number
  ): Promise<boolean>;

  /**
   * Capture the visible viewport of a tab as a downscaled JPEG.
   * Native capture (no page script) — returns base64 + dimensions.
   */
  captureTab(
    tabId: string,
    opts: { maxWidth: number }
  ): Promise<{ imageBase64: string; width: number; height: number }>;
}

/**
 * Raw page data returned by the adapter, before normalization.
 * The shape mirrors what `executeJavaScript` returns from the page.
 */
export interface RawPageData {
  url: string;
  title: string;
  visibleText: string;
  textTruncated: boolean;
  rawElements: RawInteractiveElement[];
  rawForms: RawForm[];
  filteredCount: number;
}

export interface RawInteractiveElement {
  tagName: string;
  role: string;
  accessibleName: string;
  disabled: boolean;
  hidden: boolean;
  href?: string;
  inputType?: string;
  placeholder?: string;
  value?: string;
  checked?: boolean;
  name?: string;
  formId?: string;
}

export interface RawForm {
  action?: string;
  method?: string;
  name?: string;
  elementIndices: number[];
}

// ---------------------------------------------------------------------------
// Execution context contract — for future PROMPT 5 wiring
// ---------------------------------------------------------------------------

/**
 * The execution context manager interface. The pure `ExecutionContextManager`
 * in `pure/execution-context.ts` implements this; `BrowserActionService`
 * consumes it.
 *
 * PROMPT 5 (Agent Runtime) will:
 *   - start a new context when entering AGENT mode
 *   - call `stop()` on TAKE CONTROL
 *   - gate action dispatch on `getState() !== 'aborted'`
 */
export interface ExecutionContextManager {
  /** Start a new execution context. Returns its id. */
  start(): string;
  /** Get the current (most recently started) context id, or null. */
  currentId(): string | null;
  /** Get the state of a context by id. */
  getState(id: string): ExecutionContextStateName | null;
  /** Snapshot a context by id. */
  snapshot(id: string): ExecutionContextSnapshot | null;
  /** Increment the action count for a context. Returns the new count. */
  recordAction(id: string): number;
  /**
   * Stop (abort) a context. Subsequent `recordAction` calls on this context
   * will be rejected. Returns true if the context existed and was not already
   * aborted.
   */
  stop(id?: string, reason?: string): boolean;
  /** True if the context is aborted (or does not exist). */
  isAborted(id: string): boolean;
  /** Clear all contexts (used on dispose / app quit). */
  reset(): void;
}
