/**
 * REAL_BROWSER_RESEARCH_PIPELINE — ResearchSession over a real
 * BrowserActionService (with a fake adapter standing in for WebContents).
 *
 * PROMPT 9 correction #4B: this exercises the deterministic recorder +
 * ledger + report builder against REAL BrowserActionService dispatch
 * results — the same path the Windows desktop app uses, minus the
 * Electron WebContents (which is DEFERRED_RUNTIME in the test sandbox).
 *
 * Flow:
 *   BrowserActionService → fake adapter (navigate + readPageRaw)
 *   → real PageSnapshot
 *   → ResearchSession.recordingPort records both sources into the ledger
 *   → deterministic report builder produces a report whose sources are
 *     EXACTLY the URLs we actually visited.
 *
 * On Windows (real WebContents), the same test wiring against the real
 * BrowserCore.resolveWebContents becomes the live REAL_BROWSER_RESEARCH
 * smoke. Here it is the structural proof of the pipeline.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserActionService } from '../src/main/browser/actions/runtime/browser-action-service';
import { ExecutionContextManagerImpl } from '../src/main/browser/actions/pure/execution-context';
import { FakeActionAdapter, defaultRawPage } from './_fake-adapter';
import { FakeTabManagement, makeFakeTab } from './_fake-tab-management';
import { makeIdGen, makeClock } from './_helpers';
import { ResearchSession } from '../src/main/browser/research/runtime/research-session';
import type { AgentRunResult } from '@shared/agent-types';

function setup() {
  const adapter = new FakeActionAdapter();
  const tabs = new FakeTabManagement([makeFakeTab({ id: 'tab_1' })]);
  const exec = new ExecutionContextManagerImpl(makeIdGen('exec'), makeClock(1000));
  const now = makeClock(2_000_000);
  const service = new BrowserActionService({
    tabManagement: tabs,
    resolveWebContents: () => null,
    adapter,
    executionContext: exec,
    now,
  });
  const session = new ResearchSession();
  return { service, session, adapter, tabs, exec, now };
}

describe('REAL_BROWSER_RESEARCH_PIPELINE — session over BrowserActionService', () => {
  beforeEach(() => {
    // resettable per-test
  });

  it('records a visited source ONLY after a successful readPage (navigate alone is NOT enough)', async () => {
    const { service, session, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', { url: 'https://a.example.com/' });

    const port = session.recordingPort(
      {
        dispatch: async (input) => service.dispatch(input),
        startExecutionContext: () => service.startExecutionContext(),
        stopExecutionContext: (opts) => service.stopExecutionContext(opts ?? {}),
      },
      () => 1234
    );

    // Navigate — this alone MUST NOT create a citable source.
    const nav = await port.dispatch({ kind: 'navigate', tabId: 'tab_1', url: 'https://a.example.com/' });
    expect(nav.success).toBe(true);
    expect(session.getStats().navigated).toBe(true);
    expect(session.ledger.listVisited()).toHaveLength(0);
    expect(session.ledger.size()).toBe(0);

    // Now read the page — this records the source.
    const read = await port.dispatch({ kind: 'readPage', tabId: 'tab_1' });
    expect(read.success).toBe(true);
    expect(session.ledger.listVisited()).toHaveLength(1);
    const src = session.ledger.listVisited()[0]!;
    expect(src.url).toBe('https://a.example.com');
    expect(src.status).toBe('visited');
    expect(src.title).toBe('Example Page');
  });

  it('records TWO real sources and builds a report whose sources are EXACTLY the visited URLs', async () => {
    const { service, session, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', { url: 'https://a.example.com/' });
    adapter.configureTab('tab_1', {
      rawPage: defaultRawPage('https://a.example.com/'),
    });

    const port = session.recordingPort(
      {
        dispatch: async (input) => service.dispatch(input),
        startExecutionContext: () => service.startExecutionContext(),
        stopExecutionContext: (opts) => service.stopExecutionContext(opts ?? {}),
      },
      () => 2222
    );

    // Source A
    await port.dispatch({ kind: 'navigate', tabId: 'tab_1', url: 'https://a.example.com/' });
    await port.dispatch({ kind: 'readPage', tabId: 'tab_1' });

    // Source B — reconfigure the fake adapter to return a different URL.
    adapter.configureTab('tab_1', {
      rawPage: {
        ...defaultRawPage('https://b.example.com/'),
        url: 'https://b.example.com/',
        title: 'B Source',
        visibleText: 'B says the sky is blue.',
      },
    });
    await port.dispatch({ kind: 'navigate', tabId: 'tab_1', url: 'https://b.example.com/' });
    await port.dispatch({ kind: 'readPage', tabId: 'tab_1' });

    expect(session.ledger.listVisited()).toHaveLength(2);
    expect(session.ledger.listVisited().map((s) => s.url)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);

    const run: AgentRunResult = {
      state: 'COMPLETED',
      answer: JSON.stringify({
        summary: 'Both sources agree.',
        findings: [
          {
            claim: 'The sky is blue.',
            sources: [],
            evidence: [
              { source: 1, stance: 'SUPPORT' },
              { source: 2, stance: 'SUPPORT' },
            ],
          },
        ],
        conflicts: [],
        unknowns: [],
      }),
      stepCount: 4,
      reason: null,
      error: null,
    };

    const report = session.buildReport(run, 9999);
    expect(report.claims[0]!.status).toBe('SUPPORTED');
    expect(report.sources.map((s) => s.url)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
    expect(report.runState).toBe('COMPLETED');
    expect(report.partial).toBe(false);
  });

  it('a FAILED navigate records a failed source (in ledger, NOT citable)', async () => {
    const { service, session, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', { navigateFails: true });

    const port = session.recordingPort(
      {
        dispatch: async (input) => service.dispatch(input),
        startExecutionContext: () => service.startExecutionContext(),
        stopExecutionContext: (opts) => service.stopExecutionContext(opts ?? {}),
      },
      () => 10
    );

    const nav = await port.dispatch({ kind: 'navigate', tabId: 'tab_1', url: 'https://broken.example.com/' });
    expect(nav.success).toBe(false);
    // A failed navigate records a FAILED source — present in the ledger but
    // NOT citable.
    expect(session.ledger.size()).toBe(1);
    expect(session.ledger.listVisited()).toHaveLength(0);
    expect(session.ledger.list()[0]!.status).toBe('failed');
  });

  it('a readPage that returns no URL does NOT record a source (defensive)', async () => {
    const { service, session, adapter } = setup();
    service.startExecutionContext();
    // rawPage with empty URL — the recorder must NOT add a bogus source.
    adapter.configureTab('tab_1', {
      rawPage: { ...defaultRawPage(''), url: '' },
    });

    const port = session.recordingPort(
      {
        dispatch: async (input) => service.dispatch(input),
        startExecutionContext: () => service.startExecutionContext(),
        stopExecutionContext: (opts) => service.stopExecutionContext(opts ?? {}),
      },
      () => 10
    );

    await port.dispatch({ kind: 'navigate', tabId: 'tab_1', url: 'https://x.example.com/' });
    await port.dispatch({ kind: 'readPage', tabId: 'tab_1' });
    // No valid URL → no visited source recorded.
    expect(session.ledger.listVisited()).toHaveLength(0);
  });

  it('partial report after STOPPED run preserves collected ledger sources', async () => {
    const { service, session, adapter } = setup();
    service.startExecutionContext();
    adapter.configureTab('tab_1', { rawPage: defaultRawPage('https://a.example.com/') });

    const port = session.recordingPort(
      {
        dispatch: async (input) => service.dispatch(input),
        startExecutionContext: () => service.startExecutionContext(),
        stopExecutionContext: (opts) => service.stopExecutionContext(opts ?? {}),
      },
      () => 10
    );

    await port.dispatch({ kind: 'navigate', tabId: 'tab_1', url: 'https://a.example.com/' });
    await port.dispatch({ kind: 'readPage', tabId: 'tab_1' });

    const run: AgentRunResult = {
      state: 'STOPPED',
      answer: null,
      stepCount: 2,
      reason: 'take_control',
      error: null,
    };

    const report = session.buildReport(run, 99);
    expect(report.partial).toBe(true);
    expect(report.runState).toBe('STOPPED');
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]!.url).toBe('https://a.example.com');
    expect(report.unknowns.some((u) => u.includes('PARTIAL'))).toBe(true);
  });

  it('prompt overlay is the research mission text (not a second agent loop)', () => {
    const { session } = setup();
    const overlay = session.promptOverlay();
    expect(overlay).toContain('RESEARCH MODE');
    expect(overlay).toContain('SEARCH');
    expect(overlay).toContain('CROSS-CHECK');
    expect(overlay).toContain('CITATION RULES');
  });

  it('ledger is memory-only (no persistence methods on ResearchSession)', () => {
    const { session } = setup();
    expect((session as unknown as { persist?: unknown }).persist).toBeUndefined();
    expect((session as unknown as { load?: unknown }).load).toBeUndefined();
    expect((session.ledger as unknown as { persist?: unknown }).persist).toBeUndefined();
  });
});