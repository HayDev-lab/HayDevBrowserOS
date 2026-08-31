import { describe, it, expect } from 'vitest';
import {
  buildSafeSummary,
  buildTargetDescription,
  createTimelineEntry,
  createEventTimelineEntry,
  containsForbiddenSecret,
  sanitizeTimeline,
  REDACTION_MARKER,
} from '../src/main/browser/agent/pure/timeline-redactor';
import type { ToolResult, ToolName, AgentTimelineEntry } from '@shared/agent-types';

function makeResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    tool: 'browser.navigate',
    success: true,
    observation: 'done',
    ...overrides,
  };
}

describe('timeline-redactor / buildSafeSummary', () => {
  it('navigate shows the URL', () => {
    const summary = buildSafeSummary(
      'browser.navigate',
      { url: 'https://example.com/' },
      null
    );
    expect(summary).toContain('https://example.com/');
  });

  it('browser.read shows element count', () => {
    const summary = buildSafeSummary(
      'browser.read',
      {},
      makeResult({
        tool: 'browser.read',
        success: true,
        observation: 'read',
        data: { url: 'https://example.com/', interactiveElements: [{}, {}, {}] },
      })
    );
    expect(summary).toContain('3 elements');
  });

  it('tabs.list shows tab count', () => {
    const summary = buildSafeSummary(
      'tabs.list',
      {},
      makeResult({
        tool: 'tabs.list',
        success: true,
        observation: 'listed',
        data: { tabs: [{}, {}] },
      })
    );
    expect(summary).toContain('2 tabs');
  });

  it('page.type NEVER includes the typed text', () => {
    const summary = buildSafeSummary(
      'page.type',
      { elementId: 'el_1', text: 'supersecret123' },
      makeResult({
        tool: 'page.type',
        success: true,
        observation: 'typed',
        data: { elementId: 'el_1', charactersTyped: 13, wasPasswordField: false },
      })
    );
    expect(summary).not.toContain('supersecret123');
    expect(summary).toContain(REDACTION_MARKER);
    expect(summary).toContain('13 chars');
  });

  it('page.type on password field explicitly says redacted', () => {
    const summary = buildSafeSummary(
      'page.type',
      { elementId: 'el_2', text: 'mypassword' },
      makeResult({
        tool: 'page.type',
        success: true,
        observation: 'typed',
        data: { elementId: 'el_2', charactersTyped: 10, wasPasswordField: true },
      })
    );
    expect(summary).not.toContain('mypassword');
    expect(summary).toContain('password field');
    expect(summary).toContain(REDACTION_MARKER);
  });

  it('page.click shows element id', () => {
    const summary = buildSafeSummary(
      'page.click',
      { elementId: 'el_0' },
      null
    );
    expect(summary).toContain('el_0');
  });

  it('page.scroll shows direction and amount', () => {
    const summary = buildSafeSummary(
      'page.scroll',
      { direction: 'down', amount: 500 },
      null
    );
    expect(summary).toContain('down');
    expect(summary).toContain('500');
  });

  it('agent.stop shows reason', () => {
    const summary = buildSafeSummary(
      'agent.stop',
      { reason: 'task_complete' },
      null
    );
    expect(summary).toContain('task_complete');
  });

  it('truncates long URLs', () => {
    const longUrl = 'https://example.com/' + 'x'.repeat(200);
    const summary = buildSafeSummary(
      'browser.navigate',
      { url: longUrl },
      null
    );
    expect(summary.length).toBeLessThan(longUrl.length);
  });
});

describe('timeline-redactor / buildTargetDescription', () => {
  it('returns tab target for navigate', () => {
    const target = buildTargetDescription('browser.navigate', { tabId: 'tab_1' });
    expect(target).toBe('tab:tab_1');
  });

  it('returns "all" for tabs.list', () => {
    const target = buildTargetDescription('tabs.list', {});
    expect(target).toBe('all');
  });

  it('returns tab+el for page.click', () => {
    const target = buildTargetDescription('page.click', { tabId: 'tab_1', elementId: 'el_0' });
    expect(target).toBe('tab:tab_1,el:el_0');
  });

  it('uses "active" when tabId omitted', () => {
    const target = buildTargetDescription('browser.read', {});
    expect(target).toBe('tab:active');
  });
});

describe('timeline-redactor / createTimelineEntry', () => {
  it('creates an entry with the right shape', () => {
    const entry = createTimelineEntry({
      step: 1,
      tool: 'browser.navigate',
      args: { tabId: 'tab_1', url: 'https://example.com/' },
      result: makeResult({ success: true }),
      state: 'completed',
      now: () => 1000,
    });
    expect(entry.step).toBe(1);
    expect(entry.kind).toBe('browser.navigate');
    expect(entry.state).toBe('completed');
    expect(entry.timestamp).toBe(1000);
    expect(entry.id).toMatch(/^tl_/);
  });

  it('summary does not contain typed text for page.type', () => {
    const entry = createTimelineEntry({
      step: 2,
      tool: 'page.type',
      args: { elementId: 'el_1', text: 'secret' },
      result: makeResult({
        tool: 'page.type',
        success: true,
        data: { charactersTyped: 6, wasPasswordField: false },
      }),
      state: 'completed',
    });
    expect(entry.summary).not.toContain('secret');
  });
});

describe('timeline-redactor / createEventTimelineEntry', () => {
  it('creates a non-tool entry', () => {
    const entry = createEventTimelineEntry(0, 'user_command', 'list open tabs', 'completed', () => 1000);
    expect(entry.kind).toBe('user_command');
    expect(entry.step).toBe(0);
    expect(entry.summary).toBe('list open tabs');
    expect(entry.target).toBe('-');
  });
});

describe('timeline-redactor / containsForbiddenSecret', () => {
  it('flags long hex strings (API-key-like)', () => {
    const entry: AgentTimelineEntry = {
      id: 'tl_1',
      step: 1,
      kind: 'browser.read',
      target: 'tab:tab_1',
      state: 'completed',
      summary: 'key=abc123def4567890123456789012345678901234567890',
      timestamp: 1000,
    };
    expect(containsForbiddenSecret(entry)).toBe(true);
  });

  it('flags "api_key:value" patterns', () => {
    const entry: AgentTimelineEntry = {
      id: 'tl_1',
      step: 1,
      kind: 'browser.read',
      target: 'tab:tab_1',
      state: 'completed',
      summary: 'api_key=sk-abc123',
      timestamp: 1000,
    };
    expect(containsForbiddenSecret(entry)).toBe(true);
  });

  it('does NOT flag safe summaries', () => {
    const entry: AgentTimelineEntry = {
      id: 'tl_1',
      step: 1,
      kind: 'browser.navigate',
      target: 'tab:tab_1',
      state: 'completed',
      summary: 'navigate → https://example.com/',
      timestamp: 1000,
    };
    expect(containsForbiddenSecret(entry)).toBe(false);
  });

  it('does NOT flag "password field (redacted)"', () => {
    const entry: AgentTimelineEntry = {
      id: 'tl_1',
      step: 1,
      kind: 'page.type',
      target: 'tab:tab_1,el:el_2',
      state: 'completed',
      summary: 'type into password field → el_2 (<redacted>)',
      timestamp: 1000,
    };
    expect(containsForbiddenSecret(entry)).toBe(false);
  });

  it('flags page.type summaries that include "text:"', () => {
    const entry: AgentTimelineEntry = {
      id: 'tl_1',
      step: 1,
      kind: 'page.type',
      target: 'tab:tab_1,el:el_1',
      state: 'completed',
      summary: 'text: hello world',
      timestamp: 1000,
    };
    expect(containsForbiddenSecret(entry)).toBe(true);
  });
});

describe('timeline-redactor / sanitizeTimeline', () => {
  it('replaces forbidden entries with redacted marker', () => {
    const entries: AgentTimelineEntry[] = [
      {
        id: 'tl_1',
        step: 1,
        kind: 'browser.navigate',
        target: 'tab:tab_1',
        state: 'completed',
        summary: 'navigate → https://example.com/',
        timestamp: 1000,
      },
      {
        id: 'tl_2',
        step: 2,
        kind: 'browser.read',
        target: 'tab:tab_1',
        state: 'completed',
        summary: 'api_key=sk-leaked',
        timestamp: 2000,
      },
    ];
    const sanitized = sanitizeTimeline(entries);
    expect(sanitized[0].summary).toBe('navigate → https://example.com/');
    expect(sanitized[1].summary).toBe(REDACTION_MARKER);
  });
});
