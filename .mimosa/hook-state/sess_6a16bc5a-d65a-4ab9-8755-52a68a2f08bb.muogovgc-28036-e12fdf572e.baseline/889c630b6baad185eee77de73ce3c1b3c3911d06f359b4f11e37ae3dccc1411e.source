/**
 * MCP handler routing — integration tests over FAKE ports (PROMPT 8).
 *
 * Proves:
 *   - every MCP browser tool routes to EXACTLY ONE BrowserActionService
 *     dispatch with the correct typed ActionInput;
 *   - invalid URLs / element ids are rejected BEFORE any dispatch (reusing
 *     the EXISTING validators — no parallel rules);
 *   - agent.run / agent.stop route to the EXISTING AgentController port;
 *   - browser.take_control routes to the EXISTING takeover logic and
 *     releases the owner;
 *   - execution ownership: NONE accepted, MCP conflict busy, INTERNAL_AGENT
 *     rejected, failure always releases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ActionInput, ActionResult } from '@shared/browser-actions-types';
import type { AgentRunRequest, AgentRunResult, AgentStatusSnapshot } from '@shared/agent-types';
import type { McpBrowserPort, McpAgentPort } from '@shared/mcp-types';
import { McpOwnershipGuard } from '../src/main/browser/mcp/pure/mcp-ownership';
import { McpToolHandler } from '../src/main/browser/mcp/runtime/mcp-tool-handler';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeBrowserPort implements McpBrowserPort {
  public readonly calls: ActionInput[] = [];
  public startCalls = 0;
  public stopCalls: string[] = [];
  /** Queue of results/throws per dispatch call. */
  public readonly outcomes: Array<{ ok?: ActionResult<unknown>; throw?: Error; hang?: boolean }> = [];
  /** Deferreds for hanging dispatches (to test in-flight conflicts). */
  public readonly hanging: Array<{
    resolve: (r: ActionResult<unknown>) => void;
    reject: (e: Error) => void;
  }> = [];

  configureNext(outcome: { ok?: ActionResult<unknown>; throw?: Error; hang?: boolean }): void {
    this.outcomes.push(outcome);
  }

  startExecutionContext(): string {
    this.startCalls += 1;
    return `exec_mcp_${this.startCalls}`;
  }

  stopExecutionContext(opts: { reason?: string }): {
    executionId: string;
    aborted: boolean;
    cancelledCount: number;
  } {
    this.stopCalls.push(opts.reason ?? 'unspecified');
    return { executionId: `exec_mcp_${this.startCalls}`, aborted: false, cancelledCount: 0 };
  }

  async dispatch(input: ActionInput): Promise<ActionResult<unknown>> {
    this.calls.push(input);
    const outcome = this.outcomes.shift() ?? {
      ok: successResult(input.kind),
    };
    if (outcome.hang) {
      return new Promise<ActionResult<unknown>>((resolve, reject) => {
        this.hanging.push({ resolve, reject });
      });
    }
    if (outcome.throw) throw outcome.throw;
    return outcome.ok!;
  }

  resolveHanging(result: ActionResult<unknown>): void {
    const d = this.hanging.shift();
    d?.resolve(result);
  }
}

function successResult(kind: string): ActionResult<unknown> {
  return {
    success: true,
    data: { echoed: kind },
    executionId: 'exec_1',
    completedAt: 1,
  };
}

class FakeAgentPort implements McpAgentPort {
  public runCalls: AgentRunRequest[] = [];
  public stopCalls: string[] = [];
  public takeControlCalls: string[] = [];
  public aborted = false;
  public controlMode: 'HUMAN' | 'AGENT' = 'AGENT';
  public runResult: AgentRunResult = {
    state: 'COMPLETED',
    answer: 'done',
    stepCount: 3,
    reason: null,
    error: null,
  };

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.runCalls.push(request);
    return this.runResult;
  }

  stop(reason?: string): { accepted: boolean } {
    this.stopCalls.push(reason ?? 'user_request');
    return { accepted: this.aborted === false && this.stopCalls.length > 0 };
  }

  takeControl(reason?: string): { accepted: boolean } {
    this.takeControlCalls.push(reason ?? 'user_request');
    // EXISTING takeover semantics: abort + mode → HUMAN, browser preserved.
    this.aborted = true;
    this.controlMode = 'HUMAN';
    return { accepted: true };
  }

  getStatus(): AgentStatusSnapshot {
    return {
      state: this.aborted ? 'STOPPED' : 'IDLE',
      controlMode: this.controlMode,
      stepCount: 0,
      maxSteps: 15,
      startedAt: null,
      endedAt: null,
      reason: null,
      error: null,
      providerConfigured: true,
      providerConfig: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface Fixture {
  browser: FakeBrowserPort;
  agent: FakeAgentPort;
  guard: McpOwnershipGuard;
  handler: McpToolHandler;
}

function makeFixture(): Fixture {
  const browser = new FakeBrowserPort();
  const agent = new FakeAgentPort();
  const guard = new McpOwnershipGuard();
  const handler = new McpToolHandler({ browser, agent, ownership: guard, now: () => 1 });
  return { browser, agent, guard, handler };
}

// ---------------------------------------------------------------------------
// Browser routing — exactly ONE dispatch per tool
// ---------------------------------------------------------------------------

describe('mcp-handler / browser routing (single execution layer)', () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it('browser.navigate → exactly one dispatch with typed ActionInput', async () => {
    const payload = await f.handler.handle('browser.navigate', { tabId: 't1', url: 'https://example.com' });
    expect(payload.success).toBe(true);
    expect(f.browser.calls.length).toBe(1);
    expect(f.browser.calls[0]).toEqual({ kind: 'navigate', tabId: 't1', url: 'https://example.com' });
  });

  it('browser.read → exactly one dispatch (PageSnapshot through the service)', async () => {
    const payload = await f.handler.handle('browser.read', { tabId: 't1' });
    expect(payload.success).toBe(true);
    expect(f.browser.calls).toEqual([{ kind: 'readPage', tabId: 't1', maxTextLength: undefined, maxElements: undefined }]);
  });

  it('tabs.list / tabs.open / tabs.activate / tabs.close → one dispatch each', async () => {
    await f.handler.handle('tabs.list', {});
    expect(f.browser.calls[0]).toEqual({ kind: 'listTabs' });

    await f.handler.handle('tabs.open', { url: 'https://example.com', activate: true });
    expect(f.browser.calls[1]).toEqual({ kind: 'openTab', url: 'https://example.com', activate: true });

    await f.handler.handle('tabs.activate', { tabId: 't2' });
    expect(f.browser.calls[2]).toEqual({ kind: 'activateTab', tabId: 't2' });

    await f.handler.handle('tabs.close', { tabId: 't2' });
    expect(f.browser.calls[3]).toEqual({ kind: 'closeTab', tabId: 't2' });
  });

  it('page.click / page.type / page.scroll → one dispatch each', async () => {
    await f.handler.handle('page.click', { tabId: 't1', elementId: 'el_3' });
    expect(f.browser.calls[0]).toEqual({ kind: 'click', tabId: 't1', elementId: 'el_3' });

    await f.handler.handle('page.type', { tabId: 't1', elementId: 'el_4', text: 'hi' });
    expect(f.browser.calls[1]).toEqual({ kind: 'type', tabId: 't1', elementId: 'el_4', text: 'hi', clearFirst: undefined });

    await f.handler.handle('page.scroll', { tabId: 't1', direction: 'up' });
    expect(f.browser.calls[2]).toEqual({ kind: 'scroll', tabId: 't1', direction: 'up', amount: undefined });
  });

  it('maps a service failure into a safe error payload (unknown tab etc.)', async () => {
    f.browser.configureNext({
      ok: { success: false, error: 'tab_not_found', evidence: 'tab:t_missing', executionId: 'exec_1', completedAt: 2 },
    });
    const payload = await f.handler.handle('browser.navigate', { tabId: 't_missing', url: 'https://example.com' });
    expect(payload.success).toBe(false);
    expect(payload.errorCode).toBe('tab_not_found');
    expect(payload.safeMessage).toContain('tab:t_missing');
  });

  it('each browser operation runs inside ONE execution context (started + stopped, like the agent)', async () => {
    await f.handler.handle('tabs.list', {});
    expect(f.browser.startCalls).toBe(1);
    expect(f.browser.stopCalls).toEqual(['mcp_operation_completed']);

    // Failure path: the context is stopped even when dispatch throws.
    f.browser.configureNext({ throw: new Error('boom: service boundary exploded') });
    await f.handler.handle('tabs.list', {});
    expect(f.browser.startCalls).toBe(2);
    expect(f.browser.stopCalls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Validation reuse — rejected BEFORE any dispatch
// ---------------------------------------------------------------------------

describe('mcp-handler / validation reuses EXISTING validators', () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it('rejects javascript: URLs with ZERO dispatches (address-bar whitelist)', async () => {
    const payload = await f.handler.handle('browser.navigate', { tabId: 't1', url: 'javascript:alert(1)' });
    expect(payload.success).toBe(false);
    expect(payload.errorCode).toBe('invalid_arguments');
    expect(f.browser.calls.length).toBe(0);
  });

  it('rejects data: URLs with ZERO dispatches', async () => {
    const payload = await f.handler.handle('tabs.open', { url: 'data:text/html,hello' });
    expect(payload.success).toBe(false);
    expect(f.browser.calls.length).toBe(0);
  });

  it('rejects malformed URLs with ZERO dispatches', async () => {
    const payload = await f.handler.handle('browser.navigate', { tabId: 't1', url: 'not a url at all :' });
    expect(payload.success).toBe(false);
    expect(f.browser.calls.length).toBe(0);
  });

  it('rejects invalid elementIds with ZERO dispatches (stable-id pattern)', async () => {
    const payload = await f.handler.handle('page.click', { tabId: 't1', elementId: 'btn_submit' });
    expect(payload.success).toBe(false);
    expect(payload.errorCode).toBe('invalid_arguments');
    expect(f.browser.calls.length).toBe(0);
  });

  it('rejects oversized page.type text with ZERO dispatches', async () => {
    const payload = await f.handler.handle('page.type', { tabId: 't1', elementId: 'el_0', text: 'x'.repeat(10_001) });
    expect(payload.success).toBe(false);
    expect(f.browser.calls.length).toBe(0);
  });

  it('rejects oversized scroll amount with ZERO dispatches', async () => {
    const payload = await f.handler.handle('page.scroll', { tabId: 't1', direction: 'down', amount: 20_000 });
    expect(payload.success).toBe(false);
    expect(f.browser.calls.length).toBe(0);
  });

  it('rejects unknown tools with ZERO dispatches', async () => {
    const payload = await f.handler.handle('browser.execute_js', { code: 'process.exit(1)' });
    expect(payload.success).toBe(false);
    expect(payload.errorCode).toBe('unknown_tool');
    expect(f.browser.calls.length).toBe(0);
    expect(f.agent.runCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Agent routing — EXISTING AgentController, no second loop
// ---------------------------------------------------------------------------

describe('mcp-handler / agent routing', () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it('agent.run → exactly one AgentController.run, result mapped', async () => {
    const payload = await f.handler.handle('agent.run', { command: 'read example.com' });
    expect(payload.success).toBe(true);
    expect(f.agent.runCalls).toEqual([{ command: 'read example.com', maxSteps: undefined }]);
    expect(f.browser.calls.length).toBe(0); // never bypasses the controller
  });

  it('agent.run maps a FAILED run honestly (e.g. not_in_agent_mode)', async () => {
    f.agent.runResult = {
      state: 'FAILED',
      answer: null,
      stepCount: 0,
      reason: 'not_in_agent_mode',
      error: 'Cannot start agent run in HUMAN mode',
    };
    const payload = await f.handler.handle('agent.run', { command: 'go' });
    expect(payload.success).toBe(false);
    expect(payload.errorCode).toBe('not_in_agent_mode');
    expect(payload.safeMessage).toContain('HUMAN mode');
  });

  it('agent.stop → AgentController.stop with the reason', async () => {
    const payload = await f.handler.handle('agent.stop', { reason: 'task complete' });
    expect(payload.success).toBe(true);
    expect(f.agent.stopCalls).toEqual(['task complete']);
  });

  it('browser.status aggregates EXISTING controller status (no dispatch)', async () => {
    const payload = await f.handler.handle('browser.status', {});
    expect(payload.success).toBe(true);
    expect(payload.status).toBe('ok');
    const data = payload.data as Record<string, unknown>;
    expect(data.controlMode).toBe('AGENT');
    expect(data.agentState).toBe('IDLE');
    expect(data.providerConfigured).toBe(true);
    expect(data.executionOwner).toBe('NONE');
    expect(f.browser.calls.length).toBe(0);
    expect(f.agent.runCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TAKE CONTROL — existing takeover logic, owner released
// ---------------------------------------------------------------------------

describe('mcp-handler / TAKE CONTROL', () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it('routes to the EXISTING takeover: agent aborted, HUMAN, owner cleared', async () => {
    // Simulate the wiring: an internal agent run is active.
    f.guard.markInternalAgentActive(true);
    expect(f.guard.getOwner()).toBe('INTERNAL_AGENT');

    const payload = await f.handler.handle('browser.take_control', { reason: 'user override' });

    expect(f.agent.takeControlCalls).toEqual(['user override']);
    expect(f.agent.aborted).toBe(true); // current internal agent run → aborted
    expect(f.agent.controlMode).toBe('HUMAN'); // control mode → HUMAN
    expect(payload.success).toBe(true);
    const data = payload.data as Record<string, unknown>;
    expect(data.controlMode).toBe('HUMAN');
    expect(data.executionOwner).toBe('NONE'); // owner released
    expect(f.guard.getOwner()).toBe('NONE');
    // Browser state preserved: no dispatch happened (no tab/session touched).
    expect(f.browser.calls.length).toBe(0);
  });

  it('take_control works from idle too (idempotent emergency brake)', async () => {
    const payload = await f.handler.handle('browser.take_control', {});
    expect(payload.success).toBe(true);
    expect(f.agent.takeControlCalls.length).toBe(1);
    expect(f.guard.getOwner()).toBe('NONE');
  });
});

// ---------------------------------------------------------------------------
// Ownership — the V1 policy table, end to end through the handler
// ---------------------------------------------------------------------------

describe('mcp-handler / execution ownership policy', () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it('NONE → MCP action accepted', async () => {
    const payload = await f.handler.handle('tabs.list', {});
    expect(payload.success).toBe(true);
    expect(f.guard.getOwner()).toBe('NONE'); // released after completion
  });

  it('MCP in flight → conflicting MCP execution rejected as busy', async () => {
    f.browser.configureNext({ hang: true });
    const first = f.handler.handle('browser.navigate', { tabId: 't1', url: 'https://example.com' });
    await Promise.resolve(); // let the first handler reach its await
    const second = await f.handler.handle('tabs.list', {});
    expect(second.success).toBe(false);
    expect(second.status).toBe('busy');
    expect(second.errorCode).toBe('mcp_execution_in_progress');
    expect(f.browser.calls.length).toBe(1); // only the first dispatched

    f.browser.resolveHanging(successResult('navigate'));
    const firstPayload = await first;
    expect(firstPayload.success).toBe(true);
    expect(f.guard.getOwner()).toBe('NONE'); // released after completion
  });

  it('INTERNAL_AGENT → MCP direct browser action rejected', async () => {
    f.guard.markInternalAgentActive(true);
    const payload = await f.handler.handle('browser.navigate', { tabId: 't1', url: 'https://example.com' });
    expect(payload.success).toBe(false);
    expect(payload.status).toBe('rejected');
    expect(payload.errorCode).toBe('internal_agent_active');
    expect(f.browser.calls.length).toBe(0); // nothing dispatched
    expect(f.guard.getOwner()).toBe('INTERNAL_AGENT'); // agent keeps ownership
  });

  it('INTERNAL_AGENT → MCP agent.run rejected (no concurrent runs)', async () => {
    f.guard.markInternalAgentActive(true);
    const payload = await f.handler.handle('agent.run', { command: 'go' });
    expect(payload.success).toBe(false);
    expect(payload.errorCode).toBe('internal_agent_active');
    expect(f.agent.runCalls.length).toBe(0);
  });

  it('operation failure → owner ALWAYS released (try/finally)', async () => {
    f.browser.configureNext({ throw: new Error('boom: service boundary exploded') });
    const payload = await f.handler.handle('browser.navigate', { tabId: 't1', url: 'https://example.com' });
    expect(payload.success).toBe(false);
    expect(payload.errorCode).toBe('internal_error');
    expect(payload.safeMessage).toContain('boom: service boundary exploded');
    // No stack trace leaked (stack frames appear as '\n    at fn (file:1:1)'):
    expect(JSON.stringify(payload)).not.toContain('    at ');
    expect(f.guard.getOwner()).toBe('NONE'); // released despite the failure
  });

  it('agent.run failure → owner released', async () => {
    f.agent.runResult = {
      state: 'FAILED',
      answer: null,
      stepCount: 0,
      reason: 'provider_not_configured',
      error: 'AI_PROVIDER_NOT_CONFIGURED',
    };
    const payload = await f.handler.handle('agent.run', { command: 'go' });
    expect(payload.success).toBe(false);
    expect(f.guard.getOwner()).toBe('NONE');
  });

  it('agent.run holds INTERNAL_AGENT for the whole run — browser actions rejected meanwhile', async () => {
    f.agent.runResult = {
      state: 'COMPLETED',
      answer: 'ok',
      stepCount: 2,
      reason: null,
      error: null,
    };
    // The controller wires state changes to the guard; simulate a run that
    // is still active when a direct browser action arrives mid-run.
    const runPromise = f.handler.handle('agent.run', { command: 'long task' });
    expect(f.guard.getOwner()).toBe('INTERNAL_AGENT');
    const mid = await f.handler.handle('tabs.list', {});
    expect(mid.errorCode).toBe('internal_agent_active');
    const done = await runPromise;
    expect(done.success).toBe(true);
    expect(f.guard.getOwner()).toBe('NONE');
  });
});
