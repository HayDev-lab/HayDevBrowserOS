/**
 * MCP argument parser — validation tests (PROMPT 8).
 *
 * Proves:
 *   - valid arguments parse into typed requests for every tool;
 *   - malformed requests (non-object args, wrong types) are rejected;
 *   - invalid URLs are delegated to the EXISTING validators via the
 *     handler pipeline (javascript:/data: rejected);
 *   - invalid elementIds / directions / bounds are rejected;
 *   - unknown tools cannot parse anything.
 *
 * NOTE: URL protocol whitelist + element-id pattern + length bounds are
 * exercised end-to-end in mcp-handler-routing.test.ts through the real
 * handler (parseMcpArgs → validateAction) — proving REUSE, not parallel rules.
 */
import { describe, it, expect } from 'vitest';
import { parseMcpArgs } from '../src/main/browser/mcp/pure/mcp-args';

describe('mcp-args / valid arguments', () => {
  it('parses browser.navigate', () => {
    const res = parseMcpArgs('browser.navigate', { tabId: 'tab_1', url: 'https://example.com' });
    expect(res.valid).toBe(true);
    expect(res.parsed?.action).toEqual({ kind: 'navigate', tabId: 'tab_1', url: 'https://example.com' });
  });

  it('parses browser.read with optional limits', () => {
    const res = parseMcpArgs('browser.read', { tabId: 'tab_1', maxTextLength: 500, maxElements: 10 });
    expect(res.valid).toBe(true);
    expect(res.parsed?.action).toEqual({
      kind: 'readPage',
      tabId: 'tab_1',
      maxTextLength: 500,
      maxElements: 10,
    });
  });

  it('parses tabs.list with empty args / undefined args', () => {
    expect(parseMcpArgs('tabs.list', {}).valid).toBe(true);
    expect(parseMcpArgs('tabs.list', undefined).valid).toBe(true);
    expect(parseMcpArgs('tabs.list', null).valid).toBe(true);
  });

  it('parses tabs.open (all optionals)', () => {
    const res = parseMcpArgs('tabs.open', { url: 'https://example.com', activate: false });
    expect(res.valid).toBe(true);
    expect(res.parsed?.action).toEqual({ kind: 'openTab', url: 'https://example.com', activate: false });
    expect(parseMcpArgs('tabs.open', {}).valid).toBe(true);
  });

  it('parses tabs.activate and tabs.close', () => {
    expect(parseMcpArgs('tabs.activate', { tabId: 't1' }).parsed?.action).toEqual({
      kind: 'activateTab',
      tabId: 't1',
    });
    expect(parseMcpArgs('tabs.close', { tabId: 't1' }).parsed?.action).toEqual({
      kind: 'closeTab',
      tabId: 't1',
    });
  });

  it('parses page.click / page.type / page.scroll', () => {
    expect(parseMcpArgs('page.click', { tabId: 't1', elementId: 'el_0' }).parsed?.action).toEqual({
      kind: 'click',
      tabId: 't1',
      elementId: 'el_0',
    });
    expect(
      parseMcpArgs('page.type', { tabId: 't1', elementId: 'el_1', text: 'hello', clearFirst: false }).parsed?.action
    ).toEqual({ kind: 'type', tabId: 't1', elementId: 'el_1', text: 'hello', clearFirst: false });
    expect(parseMcpArgs('page.scroll', { tabId: 't1', direction: 'down', amount: 250 }).parsed?.action).toEqual({
      kind: 'scroll',
      tabId: 't1',
      direction: 'down',
      amount: 250,
    });
  });

  it('parses agent.run with bounded maxSteps', () => {
    const res = parseMcpArgs('agent.run', { command: 'open example.com', maxSteps: 10 });
    expect(res.valid).toBe(true);
    expect(res.parsed?.agentRequest).toEqual({ command: 'open example.com', maxSteps: 10 });
  });

  it('parses agent.stop and browser.take_control reasons', () => {
    expect(parseMcpArgs('agent.stop', { reason: 'done' }).parsed?.reason).toBe('done');
    expect(parseMcpArgs('browser.take_control', {}).parsed?.reason).toBeUndefined();
    expect(parseMcpArgs('browser.take_control', { reason: 'user asked' }).parsed?.reason).toBe('user asked');
  });
});

describe('mcp-args / malformed requests', () => {
  it('rejects non-object args', () => {
    for (const bad of ['string', 42, true, ['array']]) {
      const res = parseMcpArgs('browser.navigate', bad);
      expect(res.valid).toBe(false);
      expect(res.errors[0].field).toBe('args');
    }
  });

  it('rejects missing required fields', () => {
    expect(parseMcpArgs('browser.navigate', {}).valid).toBe(false);
    expect(parseMcpArgs('browser.navigate', { url: 'https://a.com' }).valid).toBe(false); // no tabId
    expect(parseMcpArgs('page.click', { tabId: 't1' }).valid).toBe(false); // no elementId
    expect(parseMcpArgs('page.type', { tabId: 't1', elementId: 'el_0' }).valid).toBe(false); // no text
    expect(parseMcpArgs('agent.run', {}).valid).toBe(false); // no command
  });

  it('rejects wrong types', () => {
    expect(parseMcpArgs('browser.navigate', { tabId: 5, url: 'https://a.com' }).valid).toBe(false);
    expect(parseMcpArgs('tabs.open', { activate: 'yes' }).valid).toBe(false);
    expect(parseMcpArgs('page.scroll', { tabId: 't1', direction: 'up', amount: 'lots' }).valid).toBe(false);
    expect(parseMcpArgs('browser.read', { tabId: 't1', maxTextLength: 'big' }).valid).toBe(false);
  });

  it('rejects bad scroll directions', () => {
    const res = parseMcpArgs('page.scroll', { tabId: 't1', direction: 'sideways' });
    expect(res.valid).toBe(false);
    expect(res.errors[0].field).toBe('direction');
  });

  it('rejects oversized command and reason strings', () => {
    expect(parseMcpArgs('agent.run', { command: 'x'.repeat(2001) }).valid).toBe(false);
    expect(parseMcpArgs('agent.stop', { reason: 'r'.repeat(201) }).valid).toBe(false);
  });

  it('rejects maxSteps outside the loop bounds', () => {
    expect(parseMcpArgs('agent.run', { command: 'go', maxSteps: 0 }).valid).toBe(false);
    expect(parseMcpArgs('agent.run', { command: 'go', maxSteps: 31 }).valid).toBe(false);
    expect(parseMcpArgs('agent.run', { command: 'go', maxSteps: 30 }).valid).toBe(true);
  });

  it('rejects unknown tools defensively', () => {
    const res = parseMcpArgs('vault.get_password', { domain: 'x.com' });
    expect(res.valid).toBe(false);
    expect(res.errors[0].field).toBe('tool');
  });
});
