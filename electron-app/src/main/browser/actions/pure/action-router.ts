/**
 * Action router — pure logic.
 *
 * Routes a validated `ActionInput` to the matching `ActionRuntimeAdapter`
 * method. Maps raw adapter results / errors to `ActionResult<T>`.
 *
 * NO electron import. The adapter is injected — tests use a `FakeAdapter`.
 *
 * Responsibilities:
 *   - Validate input (via `validateAction`).
 *   - Check execution context (refuse if aborted).
 *   - Call the right adapter method.
 *   - Map adapter throws to `ActionResult.error` with evidence.
 *   - Wrap successful results in the standard `ActionResult<T>` shape.
 *
 * The router does NOT own the execution context manager — the
 * `BrowserActionService` orchestrator does, and passes the relevant
 * execution id + manager to `dispatch()`.
 */
import type {
  ActionInput,
  ActionResult,
  ActionRuntimeAdapter,
  NavigateResultData,
  ListTabsResultData,
  OpenTabResultData,
  ActivateTabResultData,
  CloseTabResultData,
  ClickResultData,
  TypeResultData,
  ScrollResultData,
  StopResultData,
  PageSnapshot,
} from '@shared/browser-actions-types';
import type { TabState } from '@shared/browser-types';
import { validateAction } from './action-validator';
import {
  normalizeSnapshot,
  generateSnapshotId,
} from './snapshot-normalizer';
import type { ExecutionContextManager } from '@shared/browser-actions-types';

// ---------------------------------------------------------------------------
// BrowserCore surface — the router needs the tab-management part of
// BrowserCore. We define a minimal interface to avoid coupling the router
// to the full BrowserCore class (easier to fake in tests).
// ---------------------------------------------------------------------------

export interface TabManagementPort {
  listTabs(): TabState[];
  openTab(opts: { url?: string; activate?: boolean; incognito?: boolean }): string;
  activateTab(tabId: string): boolean;
  closeTab(tabId: string): boolean;
  /** True if the tab exists. */
  hasTab(tabId: string): boolean;
}

// ---------------------------------------------------------------------------
// Dispatch result type — the data type depends on the action kind.
// ---------------------------------------------------------------------------

export type ActionDataOf<K extends ActionInput['kind']> =
  K extends 'navigate' ? NavigateResultData
  : K extends 'readPage' ? PageSnapshot
  : K extends 'listTabs' ? ListTabsResultData
  : K extends 'openTab' ? OpenTabResultData
  : K extends 'activateTab' ? ActivateTabResultData
  : K extends 'closeTab' ? CloseTabResultData
  : K extends 'click' ? ClickResultData
  : K extends 'type' ? TypeResultData
  : K extends 'scroll' ? ScrollResultData
  : K extends 'stop' ? StopResultData
  : never;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface RouterDeps {
  adapter: ActionRuntimeAdapter;
  tabManagement: TabManagementPort;
  executionContext: ExecutionContextManager;
  /** Override Date.now for tests. */
  now?: () => number;
}

export async function dispatchAction<K extends ActionInput['kind']>(
  deps: RouterDeps,
  input: Extract<ActionInput, { kind: K }>
): Promise<ActionResult<ActionDataOf<K>>> {
  const now = deps.now ?? Date.now;
  const executionId = deps.executionContext.currentId() ?? '';

  // 1. Validate input.
  const validation = validateAction(input);
  if (!validation.valid) {
    return {
      success: false,
      error: 'invalid_input',
      evidence: validation.errors.map((e) => `${e.field}:${e.message}`).join('; '),
      executionId,
      completedAt: now(),
    } as ActionResult<ActionDataOf<K>>;
  }

  // 2. Check execution context (stop action is exempt — it doesn't need an
  //    active context, it operates on a context by id).
  if (input.kind !== 'stop') {
    if (!executionId) {
      return {
        success: false,
        error: 'no_execution_context',
        evidence: 'action_dispatched_without_active_execution_context',
        executionId: '',
        completedAt: now(),
      } as ActionResult<ActionDataOf<K>>;
    }
    if (deps.executionContext.isAborted(executionId)) {
      return {
        success: false,
        error: 'execution_aborted',
        evidence: `execution_context_${executionId}_is_aborted`,
        executionId,
        completedAt: now(),
      } as ActionResult<ActionDataOf<K>>;
    }
  }

  // 3. Record the action on the context (refuses if aborted — race condition
  //    guard).
  if (input.kind !== 'stop' && executionId) {
    const count = deps.executionContext.recordAction(executionId);
    if (count < 0) {
      return {
        success: false,
        error: 'execution_aborted',
        evidence: `execution_context_${executionId}_aborted_during_dispatch`,
        executionId,
        completedAt: now(),
      } as ActionResult<ActionDataOf<K>>;
    }
  }

  // 4. Dispatch to the right adapter / tab-management method.
  try {
    const data = (await routeByKind(deps, input, executionId)) as ActionDataOf<K>;
    return {
      success: true,
      data,
      executionId,
      completedAt: now(),
    } as ActionResult<ActionDataOf<K>>;
  } catch (err) {
    return {
      success: false,
      error: classifyError(err),
      evidence: safeEvidence(err),
      executionId,
      completedAt: now(),
    } as ActionResult<ActionDataOf<K>>;
  }
}

// ---------------------------------------------------------------------------
// Per-kind routing
// ---------------------------------------------------------------------------

async function routeByKind(
  deps: RouterDeps,
  input: ActionInput,
  executionId: string
): Promise<unknown> {
  switch (input.kind) {
    case 'navigate':
      return routeNavigate(deps, input);
    case 'readPage':
      return routeReadPage(deps, input);
    case 'listTabs':
      return routeListTabs(deps);
    case 'openTab':
      return routeOpenTab(deps, input);
    case 'activateTab':
      return routeActivateTab(deps, input);
    case 'closeTab':
      return routeCloseTab(deps, input);
    case 'click':
      return routeClick(deps, input);
    case 'type':
      return routeType(deps, input);
    case 'scroll':
      return routeScroll(deps, input);
    case 'stop':
      return routeStop(deps, input, executionId);
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}

async function routeNavigate(
  deps: RouterDeps,
  input: Extract<ActionInput, { kind: 'navigate' }>
): Promise<NavigateResultData> {
  if (!deps.tabManagement.hasTab(input.tabId)) {
    throw new ActionError('tab_not_found', `tab_id:${input.tabId}`);
  }
  const loadedUrl = await deps.adapter.navigate(input.tabId, input.url);
  return {
    tabId: input.tabId,
    url: loadedUrl,
    navigationStarted: true,
  };
}

async function routeReadPage(
  deps: RouterDeps,
  input: Extract<ActionInput, { kind: 'readPage' }>
): Promise<PageSnapshot> {
  if (!deps.tabManagement.hasTab(input.tabId)) {
    throw new ActionError('tab_not_found', `tab_id:${input.tabId}`);
  }
  const maxTextLength = input.maxTextLength ?? 10_000;
  const maxElements = input.maxElements ?? 200;
  const raw = await deps.adapter.readPageRaw(input.tabId, {
    maxTextLength,
    maxElements,
  });
  return normalizeSnapshot(raw, {
    snapshotId: generateSnapshotId(),
    tabId: input.tabId,
    maxTextLength,
    maxElements,
  });
}

async function routeListTabs(deps: RouterDeps): Promise<ListTabsResultData> {
  return { tabs: deps.tabManagement.listTabs() };
}

async function routeOpenTab(
  deps: RouterDeps,
  input: Extract<ActionInput, { kind: 'openTab' }>
): Promise<OpenTabResultData> {
  const tabId = deps.tabManagement.openTab({
    url: input.url,
    activate: input.activate,
    incognito: input.incognito,
  });
  return { tabId };
}

async function routeActivateTab(
  deps: RouterDeps,
  input: Extract<ActionInput, { kind: 'activateTab' }>
): Promise<ActivateTabResultData> {
  if (!deps.tabManagement.hasTab(input.tabId)) {
    throw new ActionError('tab_not_found', `tab_id:${input.tabId}`);
  }
  const activated = deps.tabManagement.activateTab(input.tabId);
  if (!activated) {
    throw new ActionError('activate_failed', `tab_id:${input.tabId}`);
  }
  return { tabId: input.tabId, activated };
}

async function routeCloseTab(
  deps: RouterDeps,
  input: Extract<ActionInput, { kind: 'closeTab' }>
): Promise<CloseTabResultData> {
  if (!deps.tabManagement.hasTab(input.tabId)) {
    throw new ActionError('tab_not_found', `tab_id:${input.tabId}`);
  }
  const closed = deps.tabManagement.closeTab(input.tabId);
  if (!closed) {
    throw new ActionError('close_failed', `tab_id:${input.tabId}`);
  }
  return { tabId: input.tabId, closed };
}

async function routeClick(
  deps: RouterDeps,
  input: Extract<ActionInput, { kind: 'click' }>
): Promise<ClickResultData> {
  if (!deps.tabManagement.hasTab(input.tabId)) {
    throw new ActionError('tab_not_found', `tab_id:${input.tabId}`);
  }
  const dispatched = await deps.adapter.click(input.tabId, input.elementId);
  if (!dispatched) {
    throw new ActionError(
      'element_not_clickable',
      `tab:${input.tabId},element:${input.elementId}`
    );
  }
  return {
    tabId: input.tabId,
    elementId: input.elementId,
    dispatched,
  };
}

async function routeType(
  deps: RouterDeps,
  input: Extract<ActionInput, { kind: 'type' }>
): Promise<TypeResultData> {
  if (!deps.tabManagement.hasTab(input.tabId)) {
    throw new ActionError('tab_not_found', `tab_id:${input.tabId}`);
  }
  const clearFirst = input.clearFirst ?? true;
  const result = await deps.adapter.type(
    input.tabId,
    input.elementId,
    input.text,
    clearFirst
  );
  return {
    tabId: input.tabId,
    elementId: input.elementId,
    charactersTyped: result.charactersTyped,
    wasPasswordField: result.wasPasswordField,
  };
}

async function routeScroll(
  deps: RouterDeps,
  input: Extract<ActionInput, { kind: 'scroll' }>
): Promise<ScrollResultData> {
  if (!deps.tabManagement.hasTab(input.tabId)) {
    throw new ActionError('tab_not_found', `tab_id:${input.tabId}`);
  }
  const amount = input.amount ?? 400;
  const dispatched = await deps.adapter.scroll(
    input.tabId,
    input.direction,
    amount
  );
  return {
    tabId: input.tabId,
    direction: input.direction,
    amount,
    dispatched,
  };
}

async function routeStop(
  deps: RouterDeps,
  input: Extract<ActionInput, { kind: 'stop' }>,
  currentExecutionId: string
): Promise<StopResultData> {
  const targetId = input.executionId ?? currentExecutionId;
  if (!targetId) {
    return {
      executionId: '',
      aborted: false,
      cancelledCount: 0,
    };
  }
  const aborted = deps.executionContext.stop(targetId, input.reason ?? 'user_request');
  return {
    executionId: targetId,
    aborted,
    cancelledCount: 0, // V1: no in-flight tracking.
  };
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export class ActionError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: string
  ) {
    super(`${code}: ${detail}`);
    this.name = 'ActionError';
  }
}

function classifyError(err: unknown): string {
  if (err instanceof ActionError) return err.code;
  if (err instanceof Error) {
    // Map common adapter error patterns to short codes.
    const msg = err.message.toLowerCase();
    if (msg.includes('tab_not_found')) return 'tab_not_found';
    if (msg.includes('element_not_found')) return 'element_not_found';
    if (msg.includes('element_disabled')) return 'element_disabled';
    if (msg.includes('not_editable')) return 'not_editable';
    if (msg.includes('navigate_failed')) return 'navigate_failed';
    if (msg.includes('timeout')) return 'timeout';
    if (msg.includes('aborted')) return 'aborted';
    return 'adapter_error';
  }
  return 'unknown_error';
}

function safeEvidence(err: unknown): string {
  if (err instanceof ActionError) return err.detail;
  if (err instanceof Error) {
    // Truncate to bound evidence size; strip newlines.
    const msg = err.message.replace(/\s+/g, ' ').slice(0, 200);
    return msg;
  }
  return String(err).slice(0, 200);
}
