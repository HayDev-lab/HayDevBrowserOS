/**
 * BrowserActionService integration tests.
 *
 * Verifies that the orchestrator correctly:
 *   - Manages execution contexts (start/stop).
 *   - Delegates to the pure action router.
 *   - Surfaces typed convenience methods.
 *   - Enforces cancellation boundaries.
 *   - Does NOT touch Electron (uses a fake adapter + fake tab management).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserActionService } from '../src/main/browser/actions/runtime/browser-action-service';
import { ExecutionContextManagerImpl } from '../src/main/browser/actions/pure/execution-context';
import { FakeActionAdapter, defaultRawPage } from './_fake-adapter';
import { FakeTabManagement, makeFakeTab } from './_fake-tab-management';
import { makeIdGen, makeClock } from './_helpers';

function setup() {
  const adapter = new FakeActionAdapter();
  const tabs = new FakeTabManagement([makeFakeTab({ id: 'tab_1' })]);
  const exec = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
  const now = makeClock(2_000_000);
  const service = new BrowserActionService({
    tabManagement: tabs,
    resolveWebContents: () => null, // not used by fake adapter
    adapter,
    executionContext: exec,
    now,
  });
  return { service, adapter, tabs, exec, now };
}

// ===========================================================================
// Execution context management
// ===========================================================================
describe('BrowserActionService / execution context', () => {
  it('starts an execution context', () => {
    const { service } = setup();
    const id = service.startExecutionContext();
    expect(id).toMatch(/^exec_/);
    expect(service.currentExecutionContextId()).toBe(id);
  });

  it('snapshots the current execution context', () => {
    const { service } = setup();
    const id = service.startExecutionContext();
    const snap = service.snapshotExecutionContext();
    expect(snap).not.toBeNull();
    expect(snap!.id).toBe(id);
    expect(snap!.state).toBe('idle');
  });

  it('returns null snapshot when no context exists', () => {
    const { service } = setup();
    expect(service.snapshotExecutionContext()).toBeNull();
  });

  it('stops the current execution context', () => {
    const { service } = setup();
    const id = service.startExecutionContext();
    const result = service.stopExecutionContext({ reason: 'take_control' });
    expect(result.executionId).toBe(id);
    expect(result.aborted).toBe(true);
  });

  it('stopExecutionContext with no active context returns aborted=false', () => {
    const { service } = setup();
    const result = service.stopExecutionContext();
    expect(result.aborted).toBe(false);
  });
});

// ===========================================================================
// Convenience wrappers — verify they construct correct ActionInputs
// ===========================================================================
describe('BrowserActionService / navigate', () => {
  it('navigates via the adapter', async () => {
    const { service, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', { url: 'https://final.com/' });
    const r = await service.navigate('tab_1', 'https://example.com/');
    expect(r.success).toBe(true);
    expect(r.data!.url).toBe('https://final.com/');
    expect(r.data!.navigationStarted).toBe(true);
  });

  it('fails without an execution context', async () => {
    const { service } = setup();
    const r = await service.navigate('tab_1', 'https://example.com/');
    expect(r.success).toBe(false);
    expect(r.error).toBe('no_execution_context');
  });
});

describe('BrowserActionService / readPage', () => {
  it('returns a PageSnapshot', async () => {
    const { service, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', { rawPage: defaultRawPage('https://example.com/') });
    const r = await service.readPage('tab_1');
    expect(r.success).toBe(true);
    expect(r.data!.url).toBe('https://example.com/');
    expect(r.data!.interactiveElements.length).toBe(4);
  });

  it('redacts password fields in the snapshot', async () => {
    const { service, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', { rawPage: defaultRawPage() });
    const r = await service.readPage('tab_1');
    const pwEl = r.data!.interactiveElements.find((e) => e.inputType === 'password');
    expect(pwEl!.valueState).toBe('<redacted>');
  });
});

describe('BrowserActionService / listTabs', () => {
  it('returns the current tab list', async () => {
    const { service } = setup();
    service.startExecutionContext();
    const r = await service.listTabs();
    expect(r.success).toBe(true);
    expect(r.data!.tabs.length).toBe(1);
  });
});

describe('BrowserActionService / openTab', () => {
  it('creates a tab', async () => {
    const { service, tabs } = setup();
    service.startExecutionContext();
    const r = await service.openTab({ url: 'https://example.com/', activate: true });
    expect(r.success).toBe(true);
    expect(r.data!.tabId).toMatch(/^fake_tab_/);
    expect(tabs.hasTab(r.data!.tabId)).toBe(true);
  });
});

describe('BrowserActionService / activateTab', () => {
  it('activates an existing tab', async () => {
    const { service, tabs } = setup();
    service.startExecutionContext();
    tabs.addTab(makeFakeTab({ id: 'tab_2', isActive: false }));
    const r = await service.activateTab('tab_2');
    expect(r.success).toBe(true);
    expect(r.data!.activated).toBe(true);
  });
});

describe('BrowserActionService / closeTab', () => {
  it('closes an existing tab', async () => {
    const { service, tabs } = setup();
    service.startExecutionContext();
    tabs.addTab(makeFakeTab({ id: 'tab_2' }));
    const r = await service.closeTab('tab_2');
    expect(r.success).toBe(true);
    expect(r.data!.closed).toBe(true);
    expect(tabs.hasTab('tab_2')).toBe(false);
  });
});

describe('BrowserActionService / click', () => {
  it('dispatches click via adapter', async () => {
    const { service, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', {
      clickResults: new Map([
        ['el_0', { found: true, disabled: false, clicked: true }],
      ]),
    });
    const r = await service.click('tab_1', 'el_0');
    expect(r.success).toBe(true);
    expect(r.data!.dispatched).toBe(true);
  });

  it('rejects malformed elementId', async () => {
    const { service } = setup();
    service.startExecutionContext();
    const r = await service.click('tab_1', '#submit');
    expect(r.success).toBe(false);
    expect(r.error).toBe('invalid_input');
  });
});

describe('BrowserActionService / type', () => {
  it('types text via adapter', async () => {
    const { service, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', {
      typeResults: new Map([
        [
          'el_1',
          {
            found: true,
            editable: true,
            charactersTyped: 5,
            wasPasswordField: false,
          },
        ],
      ]),
    });
    const r = await service.type('tab_1', 'el_1', 'hello');
    expect(r.success).toBe(true);
    expect(r.data!.charactersTyped).toBe(5);
  });

  it('reports password field flag', async () => {
    const { service, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', {
      typeResults: new Map([
        [
          'el_2',
          {
            found: true,
            editable: true,
            charactersTyped: 8,
            wasPasswordField: true,
          },
        ],
      ]),
    });
    const r = await service.type('tab_1', 'el_2', 'password123');
    expect(r.success).toBe(true);
    expect(r.data!.wasPasswordField).toBe(true);
  });
});

describe('BrowserActionService / scroll', () => {
  it('dispatches scroll via adapter', async () => {
    const { service, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', { scrollSucceeds: true });
    const r = await service.scroll('tab_1', 'down', 500);
    expect(r.success).toBe(true);
    expect(r.data!.amount).toBe(500);
    expect(r.data!.dispatched).toBe(true);
  });
});

// ===========================================================================
// Cancellation boundary — full flow
// ===========================================================================
describe('BrowserActionService / TAKE CONTROL flow', () => {
  it('actions are rejected after stopExecutionContext', async () => {
    const { service } = setup();
    service.startExecutionContext();
    // First action succeeds.
    const r1 = await service.listTabs();
    expect(r1.success).toBe(true);
    // TAKE CONTROL.
    service.stopExecutionContext({ reason: 'take_control' });
    // Subsequent action is rejected.
    const r2 = await service.listTabs();
    expect(r2.success).toBe(false);
    expect(r2.error).toBe('execution_aborted');
  });

  it('new execution context works after TAKE CONTROL', async () => {
    const { service } = setup();
    const ctx1 = service.startExecutionContext();
    await service.listTabs();
    service.stopExecutionContext({ reason: 'take_control' });
    // Start a fresh context.
    const ctx2 = service.startExecutionContext();
    expect(ctx2).not.toBe(ctx1);
    const r = await service.listTabs();
    expect(r.success).toBe(true);
    expect(r.executionId).toBe(ctx2);
  });

  it('stop does not destroy tab state', async () => {
    const { service, tabs } = setup();
    service.startExecutionContext();
    service.stopExecutionContext({ reason: 'take_control' });
    // Tab still exists.
    expect(tabs.hasTab('tab_1')).toBe(true);
    expect(tabs.listTabs().length).toBe(1);
  });

  it('stop returns the stopped execution id', async () => {
    const { service } = setup();
    const id = service.startExecutionContext();
    const result = service.stopExecutionContext({ reason: 'take_control' });
    expect(result.executionId).toBe(id);
    expect(result.aborted).toBe(true);
  });
});

// ===========================================================================
// dispose
// ===========================================================================
describe('BrowserActionService / dispose', () => {
  it('clears all execution contexts', () => {
    const { service, exec } = setup();
    service.startExecutionContext();
    service.startExecutionContext();
    service.dispose();
    expect(exec.list().length).toBe(0);
    expect(service.currentExecutionContextId()).toBeNull();
  });
});

// ===========================================================================
// Generic dispatch entry point
// ===========================================================================
describe('BrowserActionService / generic dispatch', () => {
  it('accepts an ActionInput and returns an ActionResult', async () => {
    const { service } = setup();
    service.startExecutionContext();
    const r = await service.dispatch({ kind: 'listTabs' });
    expect(r.success).toBe(true);
    expect(r.data!.tabs.length).toBe(1);
  });

  it('rejects invalid input via dispatch', async () => {
    const { service } = setup();
    service.startExecutionContext();
    const r = await service.dispatch({
      kind: 'navigate',
      tabId: 'tab_1',
      url: 'javascript:alert(1)',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('invalid_input');
  });
});
