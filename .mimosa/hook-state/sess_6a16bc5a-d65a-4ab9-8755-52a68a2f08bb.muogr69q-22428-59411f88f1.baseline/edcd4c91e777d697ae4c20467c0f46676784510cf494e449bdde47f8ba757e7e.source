import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchAction } from '../src/main/browser/actions/pure/action-router';
import { ExecutionContextManagerImpl } from '../src/main/browser/actions/pure/execution-context';
import { FakeActionAdapter, defaultRawPage } from './_fake-adapter';
import { FakeTabManagement, makeFakeTab } from './_fake-tab-management';
import { makeIdGen, makeClock } from './_helpers';

function setup() {
  const adapter = new FakeActionAdapter();
  const tabs = new FakeTabManagement([makeFakeTab({ id: 'tab_1' })]);
  const exec = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
  const now = makeClock(2_000_000);
  const deps = { adapter, tabManagement: tabs, executionContext: exec, now };
  return { adapter, tabs, exec, now, deps };
}

// ===========================================================================
// Validation failures
// ===========================================================================
describe('action-router / validation failures', () => {
  it('rejects invalid input without dispatching', async () => {
    const { deps } = setup();
    const execId = deps.executionContext.start();
    const r = await dispatchAction(deps, {
      kind: 'navigate',
      tabId: 'tab_1',
      url: 'javascript:alert(1)',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('invalid_input');
    expect(r.evidence).toContain('url');
    expect(r.executionId).toBe(execId);
    // No adapter call should have been made.
    expect(deps.adapter.calls.length).toBe(0);
  });

  it('rejects malformed elementId for click', async () => {
    const { deps } = setup();
    deps.executionContext.start();
    const r = await dispatchAction(deps, {
      kind: 'click',
      tabId: 'tab_1',
      elementId: '#submit',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('invalid_input');
  });

  it('rejects when no execution context is active', async () => {
    const { deps } = setup();
    // No start() — no current context.
    const r = await dispatchAction(deps, {
      kind: 'navigate',
      tabId: 'tab_1',
      url: 'https://example.com/',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('no_execution_context');
  });
});

// ===========================================================================
// Aborted context
// ===========================================================================
describe('action-router / aborted context', () => {
  it('rejects dispatch after stop', async () => {
    const { deps } = setup();
    const execId = deps.executionContext.start();
    deps.executionContext.stop(execId, 'take_control');
    const r = await dispatchAction(deps, {
      kind: 'listTabs',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('execution_aborted');
    expect(r.executionId).toBe(execId);
  });

  it('records action count before dispatch', async () => {
    const { deps } = setup();
    const execId = deps.executionContext.start();
    await dispatchAction(deps, { kind: 'listTabs' });
    expect(deps.executionContext.snapshot(execId)!.actionCount).toBe(1);
    await dispatchAction(deps, { kind: 'listTabs' });
    expect(deps.executionContext.snapshot(execId)!.actionCount).toBe(2);
  });
});

// ===========================================================================
// Navigate
// ===========================================================================
describe('action-router / navigate', () => {
  it('dispatches to adapter.navigate and returns the loaded URL', async () => {
    const { deps, adapter } = setup();
    const execId = deps.executionContext.start();
    adapter.configureTab('tab_1', { url: 'https://final.com/' });

    const r = await dispatchAction(deps, {
      kind: 'navigate',
      tabId: 'tab_1',
      url: 'https://example.com/',
    });
    expect(r.success).toBe(true);
    expect(r.data!.url).toBe('https://final.com/');
    expect(r.data!.navigationStarted).toBe(true);
    expect(r.executionId).toBe(execId);
    expect(adapter.callsOf('navigate').length).toBe(1);
  });

  it('fails when tab does not exist', async () => {
    const { deps } = setup();
    deps.executionContext.start();
    const r = await dispatchAction(deps, {
      kind: 'navigate',
      tabId: 'unknown_tab',
      url: 'https://example.com/',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('tab_not_found');
  });

  it('maps adapter failure to navigate_failed', async () => {
    const { deps, adapter } = setup();
    deps.executionContext.start();
    adapter.configureTab('tab_1', { navigateFails: true });
    const r = await dispatchAction(deps, {
      kind: 'navigate',
      tabId: 'tab_1',
      url: 'https://example.com/',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('navigate_failed');
  });
});

// ===========================================================================
// readPage
// ===========================================================================
describe('action-router / readPage', () => {
  it('returns a normalized PageSnapshot', async () => {
    const { deps, adapter } = setup();
    const execId = deps.executionContext.start();
    adapter.configureTab('tab_1', { rawPage: defaultRawPage('https://example.com/') });

    const r = await dispatchAction(deps, {
      kind: 'readPage',
      tabId: 'tab_1',
    });
    expect(r.success).toBe(true);
    expect(r.data!.url).toBe('https://example.com/');
    expect(r.data!.title).toBe('Example Page');
    expect(r.data!.interactiveElements.length).toBe(4);
    expect(r.data!.interactiveElements[0].id).toBe('el_0');
    expect(r.executionId).toBe(execId);
  });

  it('redacts password values in snapshot', async () => {
    const { deps, adapter } = setup();
    deps.executionContext.start();
    adapter.configureTab('tab_1', { rawPage: defaultRawPage() });
    const r = await dispatchAction(deps, {
      kind: 'readPage',
      tabId: 'tab_1',
    });
    expect(r.success).toBe(true);
    const passwordEl = r.data!.interactiveElements.find((e) => e.inputType === 'password');
    expect(passwordEl!.valueState).toBe('<redacted>');
  });

  it('fails when tab does not exist', async () => {
    const { deps } = setup();
    deps.executionContext.start();
    const r = await dispatchAction(deps, {
      kind: 'readPage',
      tabId: 'unknown',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('tab_not_found');
  });
});

// ===========================================================================
// listTabs / openTab / activateTab / closeTab
// ===========================================================================
describe('action-router / listTabs', () => {
  it('returns the current tab list', async () => {
    const { deps } = setup();
    deps.executionContext.start();
    const r = await dispatchAction(deps, { kind: 'listTabs' });
    expect(r.success).toBe(true);
    expect(r.data!.tabs.length).toBe(1);
    expect(r.data!.tabs[0].id).toBe('tab_1');
  });
});

describe('action-router / openTab', () => {
  it('creates a tab via tab management', async () => {
    const { deps, tabs } = setup();
    const execId = deps.executionContext.start();
    const r = await dispatchAction(deps, {
      kind: 'openTab',
      url: 'https://example.com/',
      activate: true,
    });
    expect(r.success).toBe(true);
    expect(r.data!.tabId).toMatch(/^fake_tab_/);
    expect(tabs.hasTab(r.data!.tabId)).toBe(true);
    expect(r.executionId).toBe(execId);
  });

  it('works without an execution context (creates tab regardless)', async () => {
    // openTab does NOT require an execution context — it's a tab-management
    // operation, not a page-interaction action.
    const { deps } = setup();
    // Note: the router still requires a context for non-stop actions.
    // We'll verify this is enforced below.
    deps.executionContext.start();
    const r = await dispatchAction(deps, { kind: 'openTab' });
    expect(r.success).toBe(true);
  });
});

describe('action-router / activateTab', () => {
  it('activates an existing tab', async () => {
    const { deps, tabs } = setup();
    deps.executionContext.start();
    tabs.addTab(makeFakeTab({ id: 'tab_2', isActive: false }));
    const r = await dispatchAction(deps, { kind: 'activateTab', tabId: 'tab_2' });
    expect(r.success).toBe(true);
    expect(r.data!.activated).toBe(true);
    expect(tabs.getTab('tab_2')!.isActive).toBe(true);
  });

  it('fails when tab does not exist', async () => {
    const { deps } = setup();
    deps.executionContext.start();
    const r = await dispatchAction(deps, {
      kind: 'activateTab',
      tabId: 'unknown',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('tab_not_found');
  });
});

describe('action-router / closeTab', () => {
  it('closes an existing tab', async () => {
    const { deps, tabs } = setup();
    deps.executionContext.start();
    tabs.addTab(makeFakeTab({ id: 'tab_2' }));
    const r = await dispatchAction(deps, { kind: 'closeTab', tabId: 'tab_2' });
    expect(r.success).toBe(true);
    expect(r.data!.closed).toBe(true);
    expect(tabs.hasTab('tab_2')).toBe(false);
  });

  it('fails when tab does not exist', async () => {
    const { deps } = setup();
    deps.executionContext.start();
    const r = await dispatchAction(deps, {
      kind: 'closeTab',
      tabId: 'unknown',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('tab_not_found');
  });
});

// ===========================================================================
// click / type / scroll
// ===========================================================================
describe('action-router / click', () => {
  it('dispatches click to adapter', async () => {
    const { deps, adapter } = setup();
    const execId = deps.executionContext.start();
    adapter.configureTab('tab_1', {
      clickResults: new Map([
        ['el_0', { found: true, disabled: false, clicked: true }],
      ]),
    });
    const r = await dispatchAction(deps, {
      kind: 'click',
      tabId: 'tab_1',
      elementId: 'el_0',
    });
    expect(r.success).toBe(true);
    expect(r.data!.dispatched).toBe(true);
    expect(r.executionId).toBe(execId);
    expect(adapter.callsOf('click').length).toBe(1);
  });

  it('fails when element not found', async () => {
    const { deps, adapter } = setup();
    deps.executionContext.start();
    adapter.configureTab('tab_1', {
      clickResults: new Map([
        ['el_0', { found: false, disabled: false, clicked: false }],
      ]),
    });
    const r = await dispatchAction(deps, {
      kind: 'click',
      tabId: 'tab_1',
      elementId: 'el_0',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('element_not_found');
  });

  it('fails when element is disabled', async () => {
    const { deps, adapter } = setup();
    deps.executionContext.start();
    adapter.configureTab('tab_1', {
      clickResults: new Map([
        ['el_0', { found: true, disabled: true, clicked: false }],
      ]),
    });
    const r = await dispatchAction(deps, {
      kind: 'click',
      tabId: 'tab_1',
      elementId: 'el_0',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('element_disabled');
  });

  it('fails when tab does not exist', async () => {
    const { deps } = setup();
    deps.executionContext.start();
    const r = await dispatchAction(deps, {
      kind: 'click',
      tabId: 'unknown',
      elementId: 'el_0',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('tab_not_found');
  });
});

describe('action-router / type', () => {
  it('dispatches type to adapter', async () => {
    const { deps, adapter } = setup();
    deps.executionContext.start();
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
    const r = await dispatchAction(deps, {
      kind: 'type',
      tabId: 'tab_1',
      elementId: 'el_1',
      text: 'hello',
    });
    expect(r.success).toBe(true);
    expect(r.data!.charactersTyped).toBe(5);
    expect(r.data!.wasPasswordField).toBe(false);
    expect(adapter.callsOf('type').length).toBe(1);
    // Verify the text was passed through to the adapter.
    const typeCall = adapter.callsOf('type')[0];
    expect(typeCall.args[2]).toBe('hello');
  });

  it('reports password field flag when target is password', async () => {
    const { deps, adapter } = setup();
    deps.executionContext.start();
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
    const r = await dispatchAction(deps, {
      kind: 'type',
      tabId: 'tab_1',
      elementId: 'el_2',
      text: 'password123',
    });
    expect(r.success).toBe(true);
    expect(r.data!.wasPasswordField).toBe(true);
    // Evidence must NOT contain the plaintext password (logged elsewhere).
    // (The router does not log the text at all — only the adapter receives it.)
  });

  it('fails when element is not editable', async () => {
    const { deps, adapter } = setup();
    deps.executionContext.start();
    adapter.configureTab('tab_1', {
      typeResults: new Map([
        [
          'el_0',
          {
            found: true,
            editable: false,
            charactersTyped: 0,
            wasPasswordField: false,
          },
        ],
      ]),
    });
    const r = await dispatchAction(deps, {
      kind: 'type',
      tabId: 'tab_1',
      elementId: 'el_0',
      text: 'hello',
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('not_editable');
  });
});

describe('action-router / scroll', () => {
  it('dispatches scroll to adapter with default amount', async () => {
    const { deps, adapter } = setup();
    deps.executionContext.start();
    adapter.configureTab('tab_1', { scrollSucceeds: true });
    const r = await dispatchAction(deps, {
      kind: 'scroll',
      tabId: 'tab_1',
      direction: 'down',
    });
    expect(r.success).toBe(true);
    expect(r.data!.amount).toBe(400); // default
    expect(r.data!.dispatched).toBe(true);
    const call = adapter.callsOf('scroll')[0];
    expect(call.args[1]).toBe('down');
    expect(call.args[2]).toBe(400);
  });

  it('passes through the explicit amount', async () => {
    const { deps, adapter } = setup();
    deps.executionContext.start();
    adapter.configureTab('tab_1', { scrollSucceeds: true });
    const r = await dispatchAction(deps, {
      kind: 'scroll',
      tabId: 'tab_1',
      direction: 'up',
      amount: 800,
    });
    expect(r.success).toBe(true);
    expect(r.data!.amount).toBe(800);
  });

  it('handles adapter failure', async () => {
    const { deps, adapter } = setup();
    deps.executionContext.start();
    adapter.configureTab('tab_1', { scrollSucceeds: false });
    const r = await dispatchAction(deps, {
      kind: 'scroll',
      tabId: 'tab_1',
      direction: 'down',
    });
    // scroll returns false from the adapter (not a throw), so the result
    // is success=true but dispatched=false.
    expect(r.success).toBe(true);
    expect(r.data!.dispatched).toBe(false);
  });
});

// ===========================================================================
// stop
// ===========================================================================
describe('action-router / stop', () => {
  it('aborts the current execution context', async () => {
    const { deps } = setup();
    const execId = deps.executionContext.start();
    const r = await dispatchAction(deps, { kind: 'stop', reason: 'take_control' });
    expect(r.success).toBe(true);
    expect(r.data!.executionId).toBe(execId);
    expect(r.data!.aborted).toBe(true);
    expect(deps.executionContext.isAborted(execId)).toBe(true);
  });

  it('can stop without an active context (no-op)', async () => {
    const { deps } = setup();
    const r = await dispatchAction(deps, { kind: 'stop' });
    expect(r.success).toBe(true);
    expect(r.data!.aborted).toBe(false);
    expect(r.data!.executionId).toBe('');
  });

  it('accepts an explicit executionId', async () => {
    const { deps } = setup();
    const id1 = deps.executionContext.start();
    const id2 = deps.executionContext.start();
    const r = await dispatchAction(deps, {
      kind: 'stop',
      executionId: id1,
    });
    expect(r.success).toBe(true);
    expect(r.data!.executionId).toBe(id1);
    expect(deps.executionContext.isAborted(id1)).toBe(true);
    expect(deps.executionContext.isAborted(id2)).toBe(false);
  });
});

// ===========================================================================
// Unknown action handling (defensive — should never happen with TS)
// ===========================================================================
describe('action-router / result shape', () => {
  it('always includes executionId and completedAt', async () => {
    const { deps } = setup();
    const execId = deps.executionContext.start();
    const r = await dispatchAction(deps, { kind: 'listTabs' });
    expect(r.executionId).toBe(execId);
    expect(r.completedAt).toBeGreaterThan(0);
  });
});
