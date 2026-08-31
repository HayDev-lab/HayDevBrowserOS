/**
 * BrowserActionService — the single execution layer for browser automation.
 *
 * Consumers:
 *   - Internal Ollama Agent (PROMPT 5)
 *   - Local MCP Server (PROMPT 8)
 *   - Future Jarvis (out of V1 scope)
 *
 * Architecture:
 *
 *     User Command (PROMPT 5) / MCP Request (PROMPT 8)
 *                       ↓
 *              BrowserActionService
 *                       ↓
 *         ┌─────────────┴─────────────┐
 *         ↓                           ↓
 *   ActionRouter (pure)      ActionRuntimeAdapter (Electron)
 *         ↓                           ↓
 *   ExecutionContextManager    WebContents.executeJavaScript
 *   (pure — cancellation)      (click / type / scroll / readPage)
 *         ↓
 *   TabManagementPort
 *   (existing BrowserCore)
 *
 * The service is a thin orchestrator:
 *   - Owns the ExecutionContextManager.
 *   - Owns the ActionRuntimeAdapter (or accepts an injected one).
 *   - Delegates tab operations to the existing BrowserCore via TabManagementPort.
 *
 * DEFERRED_RUNTIME: this module imports `electron` transitively (via
 * WebContentsActionAdapter and BrowserCore). The pure router + execution
 * context + validator + normalizer are unit-tested separately.
 *
 * SECURITY:
 *   - No raw Node/Electron exposure to callers.
 *   - No eval.
 *   - No arbitrary JS from caller.
 *   - Password values redacted in PageSnapshot.
 *   - All inputs validated before dispatch.
 *   - Execution context boundary enforces TAKE CONTROL semantics.
 */
import type {
  ActionInput,
  ActionResult,
  ActionRuntimeAdapter,
  ExecutionContextManager,
} from '@shared/browser-actions-types';
import type { TabState } from '@shared/browser-types';
import {
  ExecutionContextManagerImpl,
  stopContext,
} from '../pure/execution-context';
import {
  dispatchAction,
  type TabManagementPort,
  type RouterDeps,
  type ActionDataOf,
} from '../pure/action-router';
import { WebContentsActionAdapter } from './webcontents-action-adapter';
import type { WebContents } from 'electron';

// ---------------------------------------------------------------------------
// Service dependencies
// ---------------------------------------------------------------------------

export interface BrowserActionServiceDeps {
  /**
   * The existing BrowserCore — provides tab management operations.
   * The service does NOT modify BrowserCore; it only calls its public API.
   */
  tabManagement: TabManagementPort;
  /**
   * Resolve a tab id to its WebContents — used by the WebContentsActionAdapter.
   * In production, this is provided by BrowserCore (or a thin shim over it).
   */
  resolveWebContents: (tabId: string) => WebContents | null;
  /**
   * Optional injected adapter (for tests / future swapping).
   * If omitted, the service constructs a `WebContentsActionAdapter`.
   */
  adapter?: ActionRuntimeAdapter;
  /**
   * Optional injected execution context manager (for tests).
   * If omitted, the service constructs an `ExecutionContextManagerImpl`.
   */
  executionContext?: ExecutionContextManager;
  /** Override Date.now for tests. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class BrowserActionService {
  private readonly adapter: ActionRuntimeAdapter;
  private readonly executionContext: ExecutionContextManager;
  private readonly now: () => number;

  constructor(private deps: BrowserActionServiceDeps) {
    this.adapter =
      deps.adapter ??
      new WebContentsActionAdapter({
        resolveWebContents: deps.resolveWebContents,
      });
    this.executionContext = deps.executionContext ?? new ExecutionContextManagerImpl();
    this.now = deps.now ?? Date.now;
  }

  // ---------------------------------------------------------------------------
  // Execution context — public API for PROMPT 5
  // ---------------------------------------------------------------------------

  /**
   * Start a new execution context. Returns its id.
   *
   * PROMPT 5 will call this when entering AGENT mode.
   */
  startExecutionContext(): string {
    return this.executionContext.start();
  }

  /**
   * Get the current execution context id (or null if none active).
   */
  currentExecutionContextId(): string | null {
    return this.executionContext.currentId();
  }

  /**
   * Snapshot the current execution context (or null if none).
   */
  snapshotExecutionContext() {
    const id = this.executionContext.currentId();
    if (!id) return null;
    return this.executionContext.snapshot(id);
  }

  /**
   * Stop (abort) the current execution context.
   *
   * PROMPT 5 will call this on TAKE CONTROL.
   *
   * Returns a StopResultData describing what was aborted.
   */
  stopExecutionContext(opts: { reason?: string } = {}): {
    executionId: string;
    aborted: boolean;
    cancelledCount: number;
  } {
    return stopContext(this.executionContext, opts);
  }

  // ---------------------------------------------------------------------------
  // Action dispatch — the main entry point for PROMPT 5 (Agent) and
  // PROMPT 8 (MCP). Both call `dispatchAction(input)` with a validated
  // ActionInput.
  // ---------------------------------------------------------------------------

  async dispatch<K extends ActionInput['kind']>(
    input: Extract<ActionInput, { kind: K }>
  ): Promise<ActionResult<ActionDataOf<K>>> {
    const routerDeps: RouterDeps = {
      adapter: this.adapter,
      tabManagement: this.deps.tabManagement,
      executionContext: this.executionContext,
      now: this.now,
    };
    return dispatchAction(routerDeps, input);
  }

  // ---------------------------------------------------------------------------
  // Convenience wrappers — typed shortcuts for common actions.
  // These exist so callers don't have to construct the full ActionInput.
  // ---------------------------------------------------------------------------

  async navigate(
    tabId: string,
    url: string
  ): Promise<ActionResult<{ tabId: string; url: string; navigationStarted: boolean }>> {
    return this.dispatch({ kind: 'navigate', tabId, url });
  }

  async readPage(
    tabId: string,
    opts: { maxTextLength?: number; maxElements?: number } = {}
  ): Promise<ActionResult<import('@shared/browser-actions-types').PageSnapshot>> {
    return this.dispatch({
      kind: 'readPage',
      tabId,
      maxTextLength: opts.maxTextLength,
      maxElements: opts.maxElements,
    });
  }

  async listTabs(): Promise<ActionResult<{ tabs: TabState[] }>> {
    return this.dispatch({ kind: 'listTabs' });
  }

  async openTab(
    opts: { url?: string; activate?: boolean; incognito?: boolean } = {}
  ): Promise<ActionResult<{ tabId: string }>> {
    return this.dispatch({
      kind: 'openTab',
      url: opts.url,
      activate: opts.activate,
      incognito: opts.incognito,
    });
  }

  async activateTab(
    tabId: string
  ): Promise<ActionResult<{ tabId: string; activated: boolean }>> {
    return this.dispatch({ kind: 'activateTab', tabId });
  }

  async closeTab(
    tabId: string
  ): Promise<ActionResult<{ tabId: string; closed: boolean }>> {
    return this.dispatch({ kind: 'closeTab', tabId });
  }

  async click(
    tabId: string,
    elementId: string
  ): Promise<
    ActionResult<{ tabId: string; elementId: string; dispatched: boolean }>
  > {
    return this.dispatch({ kind: 'click', tabId, elementId });
  }

  async type(
    tabId: string,
    elementId: string,
    text: string,
    clearFirst?: boolean
  ): Promise<
    ActionResult<{
      tabId: string;
      elementId: string;
      charactersTyped: number;
      wasPasswordField: boolean;
    }>
  > {
    return this.dispatch({
      kind: 'type',
      tabId,
      elementId,
      text,
      clearFirst,
    });
  }

  async scroll(
    tabId: string,
    direction: 'up' | 'down' | 'left' | 'right',
    amount?: number
  ): Promise<
    ActionResult<{
      tabId: string;
      direction: string;
      amount: number;
      dispatched: boolean;
    }>
  > {
    return this.dispatch({ kind: 'scroll', tabId, direction, amount });
  }

  async stop(opts: { executionId?: string; reason?: string } = {}): Promise<
    ActionResult<{ executionId: string; aborted: boolean; cancelledCount: number }>
  > {
    return this.dispatch({ kind: 'stop', executionId: opts.executionId, reason: opts.reason });
  }

  // ---------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.executionContext.reset();
  }
}
