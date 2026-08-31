import { describe, it, expect } from 'vitest';
import { validateToolCall } from '../src/main/browser/agent/pure/tool-validator';
import type { ToolCall } from '@shared/agent-types';

const ACTIVE_TAB = 'tab_1';

function makeCall(
  tool: ToolCall['tool'],
  args: Record<string, unknown> = {}
): ToolCall {
  return { tool, args };
}

describe('tool-validator / browser.navigate', () => {
  it('validates a well-formed call', () => {
    const r = validateToolCall(
      makeCall('browser.navigate', { tabId: 'tab_1', url: 'https://example.com/' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(true);
    expect(r.actionInput).toBeDefined();
    expect(r.actionInput!.kind).toBe('navigate');
  });

  it('uses active tab when tabId omitted', () => {
    const r = validateToolCall(
      makeCall('browser.navigate', { url: 'https://example.com/' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(true);
    expect((r.actionInput as { tabId: string }).tabId).toBe(ACTIVE_TAB);
  });

  it('rejects missing url', () => {
    const r = validateToolCall(
      makeCall('browser.navigate', { tabId: 'tab_1' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('missing_parameter:url'))).toBe(true);
  });

  it('rejects javascript: url', () => {
    const r = validateToolCall(
      makeCall('browser.navigate', { tabId: 'tab_1', url: 'javascript:alert(1)' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
  });
});

describe('tool-validator / unknown tool', () => {
  it('rejects unknown tool names', () => {
    const r = validateToolCall(
      makeCall('execute_js' as ToolCall['tool'], { code: 'fetch("/x")' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('unknown_tool');
  });

  it('rejects shell tool', () => {
    const r = validateToolCall(
      makeCall('shell' as ToolCall['tool'], { command: 'rm -rf /' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
  });
});

describe('tool-validator / page.click', () => {
  it('validates a well-formed click', () => {
    const r = validateToolCall(
      makeCall('page.click', { tabId: 'tab_1', elementId: 'el_0' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(true);
  });

  it('rejects missing elementId', () => {
    const r = validateToolCall(
      makeCall('page.click', { tabId: 'tab_1' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('missing_parameter:elementId'))).toBe(true);
  });

  it('rejects malformed elementId (LLM-supplied CSS selector)', () => {
    const r = validateToolCall(
      makeCall('page.click', { tabId: 'tab_1', elementId: '#submit-button' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
  });
});

describe('tool-validator / page.type', () => {
  it('validates a well-formed type call', () => {
    const r = validateToolCall(
      makeCall('page.type', {
        tabId: 'tab_1',
        elementId: 'el_1',
        text: 'hello',
      }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(true);
  });

  it('rejects missing text', () => {
    const r = validateToolCall(
      makeCall('page.type', { tabId: 'tab_1', elementId: 'el_1' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
  });

  it('rejects non-string text', () => {
    const r = validateToolCall(
      makeCall('page.type', {
        tabId: 'tab_1',
        elementId: 'el_1',
        text: 123,
      }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
  });
});

describe('tool-validator / page.scroll', () => {
  it('validates a well-formed scroll', () => {
    const r = validateToolCall(
      makeCall('page.scroll', {
        tabId: 'tab_1',
        direction: 'down',
        amount: 500,
      }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(true);
  });

  it('rejects invalid direction', () => {
    const r = validateToolCall(
      makeCall('page.scroll', {
        tabId: 'tab_1',
        direction: 'sideways',
      }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
  });

  it('rejects missing direction', () => {
    const r = validateToolCall(
      makeCall('page.scroll', { tabId: 'tab_1' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
  });
});

describe('tool-validator / tabs.open', () => {
  it('validates with no args', () => {
    const r = validateToolCall(makeCall('tabs.open'), ACTIVE_TAB);
    expect(r.valid).toBe(true);
  });

  it('validates with url', () => {
    const r = validateToolCall(
      makeCall('tabs.open', { url: 'https://example.com/' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(true);
  });

  it('rejects non-boolean activate', () => {
    const r = validateToolCall(
      makeCall('tabs.open', { activate: 'yes' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(false);
  });
});

describe('tool-validator / agent.stop', () => {
  it('validates with no args', () => {
    const r = validateToolCall(makeCall('agent.stop'), ACTIVE_TAB);
    expect(r.valid).toBe(true);
  });

  it('validates with reason', () => {
    const r = validateToolCall(
      makeCall('agent.stop', { reason: 'task_complete' }),
      ACTIVE_TAB
    );
    expect(r.valid).toBe(true);
  });
});

describe('tool-validator / result mapping', () => {
  it('constructs the correct ActionInput kind for each tool', () => {
    const cases: Array<{ tool: ToolCall['tool']; args: Record<string, unknown>; expectedKind: string }> = [
      { tool: 'browser.navigate', args: { tabId: 'tab_1', url: 'https://example.com/' }, expectedKind: 'navigate' },
      { tool: 'browser.read', args: { tabId: 'tab_1' }, expectedKind: 'readPage' },
      { tool: 'tabs.list', args: {}, expectedKind: 'listTabs' },
      { tool: 'tabs.open', args: {}, expectedKind: 'openTab' },
      { tool: 'tabs.activate', args: { tabId: 'tab_1' }, expectedKind: 'activateTab' },
      { tool: 'tabs.close', args: { tabId: 'tab_1' }, expectedKind: 'closeTab' },
      { tool: 'page.click', args: { tabId: 'tab_1', elementId: 'el_0' }, expectedKind: 'click' },
      { tool: 'page.type', args: { tabId: 'tab_1', elementId: 'el_1', text: 'x' }, expectedKind: 'type' },
      { tool: 'page.scroll', args: { tabId: 'tab_1', direction: 'down' }, expectedKind: 'scroll' },
      { tool: 'agent.stop', args: {}, expectedKind: 'stop' },
    ];
    for (const c of cases) {
      const r = validateToolCall(makeCall(c.tool, c.args), ACTIVE_TAB);
      expect(r.valid).toBe(true);
      expect(r.actionInput!.kind).toBe(c.expectedKind);
    }
  });
});
