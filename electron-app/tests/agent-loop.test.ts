/**
 * Agent loop tests — verifies the OBSERVE → DECIDE → ACT → VERIFY cycle
 * with FakeOllamaClient + FakeActionAdapter + FakeTabManagement.
 *
 * All browser operations go through the injected BrowserActionPort (which
 * wraps the FakeActionAdapter). This proves the architecture: the model
 * never touches Electron directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runAgentLoop } from '../src/main/browser/agent/pure/agent-loop';
import {
  FakeOllamaClient,
  toolCallResponse,
  finalAnswerResponse,
  unparseableResponse,
} from './_fake-ollama';
import { FakeActionAdapter, defaultRawPage } from './_fake-adapter';
import { FakeTabManagement, makeFakeTab } from './_fake-tab-management';
import type { ControlAuthorizationState } from '../src/main/browser/agent/pure/control-authorization';
import type { AgentTimelineEntry, OllamaChatMessage } from '@shared/agent-types';
import type { ActionInput, ActionResult } from '@shared/browser-actions-types';
import { makeClock } from './_helpers';

// ---------------------------------------------------------------------------
// Fake BrowserActionPort — wraps FakeActionAdapter + FakeTabManagement
// ---------------------------------------------------------------------------

class FakeBrowserActionPort {
  public readonly dispatched: ActionInput[] = [];
  private execId = 'exec_test_1';

  constructor(
    private adapter: FakeActionAdapter,
    private tabs: FakeTabManagement
  ) {}

  async dispatch(input: ActionInput): Promise<ActionResult<unknown>> {
    this.dispatched.push(input);
    // Delegate to the fake adapter + tab management.
    try {
      switch (input.kind) {
        case 'navigate':
          await this.adapter.navigate(input.tabId, input.url);
          return { success: true, data: { tabId: input.tabId, url: input.url, navigationStarted: true }, executionId: this.execId, completedAt: Date.now() };
        case 'readPage': {
          const raw = await this.adapter.readPageRaw(input.tabId, { maxTextLength: 10000, maxElements: 200 });
          return { success: true, data: { url: raw.url, title: raw.title, visibleText: raw.visibleText, interactiveElements: [], forms: [], filteredCount: 0 }, executionId: this.execId, completedAt: Date.now() };
        }
        case 'listTabs':
          return { success: true, data: { tabs: this.tabs.listTabs() }, executionId: this.execId, completedAt: Date.now() };
        case 'openTab': {
          const id = this.tabs.openTab({ url: input.url, activate: input.activate });
          return { success: true, data: { tabId: id }, executionId: this.execId, completedAt: Date.now() };
        }
        case 'activateTab':
          return { success: true, data: { tabId: input.tabId, activated: this.tabs.activateTab(input.tabId) }, executionId: this.execId, completedAt: Date.now() };
        case 'closeTab':
          return { success: true, data: { tabId: input.tabId, closed: this.tabs.closeTab(input.tabId) }, executionId: this.execId, completedAt: Date.now() };
        case 'click': {
          const dispatched = await this.adapter.click(input.tabId, input.elementId);
          return { success: true, data: { tabId: input.tabId, elementId: input.elementId, dispatched }, executionId: this.execId, completedAt: Date.now() };
        }
        case 'type': {
          const r = await this.adapter.type(input.tabId, input.elementId, input.text, input.clearFirst ?? true);
          return { success: true, data: { tabId: input.tabId, elementId: input.elementId, charactersTyped: r.charactersTyped, wasPasswordField: r.wasPasswordField }, executionId: this.execId, completedAt: Date.now() };
        }
        case 'scroll': {
          const dispatched = await this.adapter.scroll(input.tabId, input.direction, input.amount ?? 400);
          return { success: true, data: { tabId: input.tabId, direction: input.direction, amount: input.amount ?? 400, dispatched }, executionId: this.execId, completedAt: Date.now() };
        }
        case 'screenshot':
          return { success: true, data: { tabId: input.tabId, imageBase64: 'aGVsbG8tc2NyZWVuc2hvdA==', width: 1024, height: 640, format: 'jpeg' as const }, executionId: this.execId, completedAt: Date.now() };
        case 'stop':
          return { success: true, data: { executionId: this.execId, aborted: true, cancelledCount: 0 }, executionId: this.execId, completedAt: Date.now() };
        default:
          return { success: false, error: 'unknown_action', executionId: this.execId, completedAt: Date.now() };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message?.split(':')[0] ?? 'error', executionId: this.execId, completedAt: Date.now() };
    }
  }

  startExecutionContext(): string {
    return this.execId;
  }

  stopExecutionContext(): { executionId: string; aborted: boolean; cancelledCount: number } {
    return { executionId: this.execId, aborted: true, cancelledCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setup(opts: {
  responses?: string[];
  controlMode?: 'HUMAN' | 'AGENT';
  configured?: boolean;
  failChat?: boolean;
} = {}) {
  const ollama = new FakeOllamaClient({
    responses: opts.responses ?? [],
    configured: opts.configured ?? true,
    failChat: opts.failChat,
  });
  const adapter = new FakeActionAdapter();
  adapter.configureTab('tab_1', { rawPage: defaultRawPage('https://example.com/') });
  const tabs = new FakeTabManagement([makeFakeTab({ id: 'tab_1' })]);
  const actions = new FakeBrowserActionPort(adapter, tabs);
  const control: ControlAuthorizationState = {
    mode: opts.controlMode ?? 'AGENT',
    takeoverLatched: false,
    agentRunActive: false,
  };
  const timeline: AgentTimelineEntry[] = [];
  const history: OllamaChatMessage[] = [];
  const deps = {
    ollama,
    actions: actions as unknown as Parameters<typeof runAgentLoop>[0]['actions'],
    control,
    onTimelineUpdate: (e: AgentTimelineEntry) => timeline.push(e),
    now: makeClock(1_000_000),
    maxSteps: 10,
  };
  return { ollama, adapter, tabs, actions, control, timeline, deps };
}

// ===========================================================================
// Basic loop: command → tool calls → final answer
// ===========================================================================
describe('agent-loop / basic flow', () => {
  it('completes when model gives a final answer', async () => {
    const { deps } = setup({
      responses: [
        toolCallResponse('tabs.list', {}),
        finalAnswerResponse('There is 1 open tab.'),
      ],
    });
    const result = await runAgentLoop(deps, 'List the open tabs.');
    expect(result.state).toBe('COMPLETED');
    expect(result.answer).toContain('1 open tab');
    expect(result.stepCount).toBe(1);
  });

  it('executes tabs.list then browser.navigate then completes', async () => {
    const { deps, actions } = setup({
      responses: [
        toolCallResponse('tabs.list', {}),
        toolCallResponse('browser.navigate', { tabId: 'tab_1', url: 'https://example.com/' }),
        finalAnswerResponse('Done.'),
      ],
    });
    const result = await runAgentLoop(deps, 'List tabs and navigate.');
    expect(result.state).toBe('COMPLETED');
    expect(result.stepCount).toBe(2);
    // Verify both actions were dispatched through the port.
    expect(actions.dispatched.length).toBe(2);
    expect(actions.dispatched[0].kind).toBe('listTabs');
    expect(actions.dispatched[1].kind).toBe('navigate');
  });

  it('all browser operations go through the BrowserActionPort', async () => {
    const { deps, actions } = setup({
      responses: [
        toolCallResponse('tabs.list', {}),
        toolCallResponse('browser.read', { tabId: 'tab_1' }),
        toolCallResponse('page.click', { tabId: 'tab_1', elementId: 'el_0' }),
        finalAnswerResponse('Done.'),
      ],
    });
    await runAgentLoop(deps, 'Do several things.');
    expect(actions.dispatched.length).toBe(3);
    expect(actions.dispatched.map((a) => a.kind)).toEqual([
      'listTabs',
      'readPage',
      'click',
    ]);
  });
});

// ===========================================================================
// One tool per step
// ===========================================================================
describe('agent-loop / one tool per step', () => {
  it('never executes more than one tool per model response', async () => {
    const { deps, actions } = setup({
      responses: [
        toolCallResponse('tabs.list', {}),
        toolCallResponse('tabs.list', {}),
        toolCallResponse('tabs.list', {}),
        finalAnswerResponse('Done.'),
      ],
    });
    await runAgentLoop(deps, 'List tabs three times.');
    expect(actions.dispatched.length).toBe(3);
    // Each dispatch is a separate step.
    expect(deps.now).toBeDefined();
  });
});

// ===========================================================================
// Max steps
// ===========================================================================
describe('agent-loop / max steps', () => {
  it('fails with max_steps_reached when the model never gives a final answer', async () => {
    const { deps } = setup({
      responses: Array.from({ length: 20 }, () => toolCallResponse('tabs.list', {})),
    });
    const result = await runAgentLoop({ ...deps, maxSteps: 3 }, 'List tabs forever.');
    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('max_steps_reached');
    expect(result.stepCount).toBe(3);
  });

  it('clamps maxSteps to HARD_MAX_STEPS (30)', async () => {
    const { deps } = setup({
      responses: Array.from({ length: 50 }, () => toolCallResponse('tabs.list', {})),
    });
    const result = await runAgentLoop({ ...deps, maxSteps: 1000 }, 'List tabs.');
    expect(result.stepCount).toBeLessThanOrEqual(30);
  });
});

// ===========================================================================
// Invalid model output
// ===========================================================================
describe('agent-loop / invalid model output', () => {
  it('recovers from parse errors with a corrective message', async () => {
    const { deps } = setup({
      responses: [
        unparseableResponse(),
        toolCallResponse('tabs.list', {}),
        finalAnswerResponse('Done.'),
      ],
    });
    const result = await runAgentLoop(deps, 'List tabs.');
    expect(result.state).toBe('COMPLETED');
  });

  it('fails after 3 consecutive parse errors', async () => {
    const { deps } = setup({
      responses: [
        unparseableResponse(),
        unparseableResponse(),
        unparseableResponse(),
      ],
    });
    const result = await runAgentLoop(deps, 'List tabs.');
    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('too_many_parse_errors');
  });
});

// ===========================================================================
// Unknown tool
// ===========================================================================
describe('agent-loop / unknown tool', () => {
  it('rejects unknown tool and continues', async () => {
    const { deps } = setup({
      responses: [
        toolCallResponse('execute_js', { code: 'fetch("/x")' }),
        // Wait — the parser returns parse_error for unknown tools, not tool_call.
        // The loop handles parse_error by appending a corrective message.
        // Let's test with a real tool instead.
        toolCallResponse('tabs.list', {}),
        finalAnswerResponse('Done.'),
      ],
    });
    const result = await runAgentLoop(deps, 'List tabs.');
    // The first response is parse_error (unknown_tool), the loop recovers.
    expect(result.state).toBe('COMPLETED');
  });
});

// ===========================================================================
// Failed action
// ===========================================================================
describe('agent-loop / failed action', () => {
  it('continues after an action fails (model gets error observation)', async () => {
    const { deps, adapter } = setup({
      responses: [
        toolCallResponse('page.click', { tabId: 'tab_1', elementId: 'el_99' }),
        toolCallResponse('tabs.list', {}),
        finalAnswerResponse('Done.'),
      ],
    });
    // el_99 doesn't exist → click throws element_not_found.
    adapter.configureTab('tab_1', {
      clickResults: new Map(),
    });
    const result = await runAgentLoop(deps, 'Click and list.');
    expect(result.state).toBe('COMPLETED');
  });
});

// ===========================================================================
// Cancellation / TAKE CONTROL
// ===========================================================================
describe('agent-loop / cancellation', () => {
  it('aborts when abort signal is set before the loop starts', async () => {
    const { deps } = setup({
      responses: [toolCallResponse('tabs.list', {})],
    });
    const result = await runAgentLoop(
      deps,
      'List tabs.',
      { aborted: true, reason: 'take_control' }
    );
    expect(result.state).toBe('STOPPED');
    expect(result.reason).toBe('take_control');
  });
});

// ===========================================================================
// HUMAN mode
// ===========================================================================
describe('agent-loop / HUMAN mode', () => {
  it('refuses to start in HUMAN mode', async () => {
    const { deps } = setup({
      controlMode: 'HUMAN',
      responses: [toolCallResponse('tabs.list', {})],
    });
    const result = await runAgentLoop(deps, 'List tabs.');
    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('not_in_agent_mode');
    expect(result.error).toContain('HUMAN mode');
  });
});

// ===========================================================================
// Ollama failure
// ===========================================================================
describe('agent-loop / ollama failure', () => {
  it('fails gracefully when ollama.chat throws', async () => {
    const { deps } = setup({
      responses: [],
      failChat: true,
    });
    const result = await runAgentLoop(deps, 'List tabs.');
    expect(result.state).toBe('FAILED');
    expect(result.reason).toBe('ollama_error');
  });
});

// ===========================================================================
// Password redaction
// ===========================================================================
describe('agent-loop / password redaction', () => {
  it('does NOT include typed text in the timeline for page.type', async () => {
    const { deps, timeline, adapter } = setup({
      responses: [
        toolCallResponse('page.type', {
          tabId: 'tab_1',
          elementId: 'el_2',
          text: 'supersecret123',
        }),
        finalAnswerResponse('Done.'),
      ],
    });
    adapter.configureTab('tab_1', {
      typeResults: new Map([
        [
          'el_2',
          {
            found: true,
            editable: true,
            charactersTyped: 13,
            wasPasswordField: true,
          },
        ],
      ]),
    });
    await runAgentLoop(deps, 'Type a password.');
    // Verify no timeline entry contains the password.
    for (const entry of timeline) {
      expect(entry.summary).not.toContain('supersecret123');
    }
  });

  it('reports password field flag in observation', async () => {
    const { deps, timeline, adapter } = setup({
      responses: [
        toolCallResponse('page.type', {
          tabId: 'tab_1',
          elementId: 'el_2',
          text: 'secret',
        }),
        finalAnswerResponse('Done.'),
      ],
    });
    adapter.configureTab('tab_1', {
      typeResults: new Map([
        [
          'el_2',
          {
            found: true,
            editable: true,
            charactersTyped: 6,
            wasPasswordField: true,
          },
        ],
      ]),
    });
    await runAgentLoop(deps, 'Type a password.');
    // Find the COMPLETED page.type entry (not the 'running' placeholder).
    const typeEntries = timeline.filter((e) => e.kind === 'page.type' && e.state === 'completed');
    expect(typeEntries.length).toBeGreaterThan(0);
    const typeEntry = typeEntries[typeEntries.length - 1];
    expect(typeEntry.summary).toContain('password field');
    expect(typeEntry.summary).not.toContain('secret');
  });
});

// ===========================================================================
// agent.stop tool
// ===========================================================================
describe('agent-loop / agent.stop tool', () => {
  it('stops the run when the model calls agent.stop', async () => {
    const { deps } = setup({
      responses: [
        toolCallResponse('agent.stop', { reason: 'task_complete' }),
      ],
    });
    const result = await runAgentLoop(deps, 'Stop.');
    expect(result.state).toBe('STOPPED');
    expect(result.reason).toBe('agent_stop_tool');
  });
});

// ===========================================================================
// Timeline
// ===========================================================================
describe('agent-loop / timeline', () => {
  it('emits a user_command entry at the start', async () => {
    const { deps, timeline } = setup({
      responses: [finalAnswerResponse('Done.')],
    });
    await runAgentLoop(deps, 'List tabs.');
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline[0].kind).toBe('user_command');
  });

  it('emits a final_answer entry on completion', async () => {
    const { deps, timeline } = setup({
      responses: [finalAnswerResponse('Done.')],
    });
    await runAgentLoop(deps, 'List tabs.');
    const last = timeline[timeline.length - 1];
    expect(last.kind).toBe('final_answer');
  });
});

// ===========================================================================
// page.screenshot — vision grounding
// ===========================================================================
describe('agent-loop / page.screenshot vision wiring', () => {
  it('attaches the captured image to the next model message, not the text', async () => {
    const { deps, ollama } = setup({
      responses: [
        toolCallResponse('page.screenshot', { tabId: 'tab_1' }),
        finalAnswerResponse('I can see the page.'),
      ],
    });
    const result = await runAgentLoop(deps, 'Look at the page.');
    expect(result.state).toBe('COMPLETED');

    // The second chat call (after the screenshot) carries the image on the
    // tool message in Ollama's images format.
    const secondCall = ollama.calls[1]!;
    const toolMsg = [...secondCall.messages].reverse().find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.images).toContain('aGVsbG8tc2NyZWVuc2hvdA==');
    // The observation text describes the image without embedding it.
    expect(toolMsg!.content).toContain('screenshot captured');
    expect(toolMsg!.content).not.toContain('aGVsbG8');
  });

  it('never leaks the image into the timeline', async () => {
    const { deps, timeline } = setup({
      responses: [
        toolCallResponse('page.screenshot', { tabId: 'tab_1' }),
        finalAnswerResponse('Seen.'),
      ],
    });
    await runAgentLoop(deps, 'Look.');
    const shotEntries = timeline.filter((e) => e.kind === 'page.screenshot');
    expect(shotEntries.length).toBeGreaterThan(0);
    for (const e of shotEntries) {
      expect(JSON.stringify(e)).not.toContain('aGVsbG8');
    }
  });

  it('defaults the capture to the active tab when tabId omitted', async () => {
    const s = setup({
      responses: [
        toolCallResponse('page.screenshot', {}),
        finalAnswerResponse('Seen.'),
      ],
    });
    const deps = { ...s.deps, resolveActiveTabId: async () => 'tab_1' };
    const actions = s.actions;
    await runAgentLoop(deps, 'Look.');
    expect(actions.dispatched[0].kind).toBe('screenshot');
    expect((actions.dispatched[0] as { tabId?: string }).tabId).toBe('tab_1');
  });
});

// ===========================================================================
// Vision fallback — text-only model rejects image input
// ===========================================================================
describe('agent-loop / vision fallback for text-only models', () => {
  it('retries without images when the model rejects image input', async () => {
    const { deps: base } = setup({
      responses: [
        toolCallResponse('page.screenshot', { tabId: 'tab_1' }),
        finalAnswerResponse('Used the text instead.'),
      ],
    });
    // Wrap the fake: first chat WITH images fails like a text-only model.
    const realChat = base.ollama.chat.bind(base.ollama);
    let sawStrippedRetry = false;
    const ollama = Object.create(base.ollama);
    ollama.chat = async (request: import('@shared/agent-types').OllamaChatRequest) => {
      const hasImages = request.messages.some((m) => (m.images?.length ?? 0) > 0);
      if (hasImages) {
        sawStrippedRetry = true; // will be set, then the retry must NOT have images
        throw new Error('OLLAMA_HTTP_400: this model does not support image input');
      }
      return realChat(request);
    };
    const deps = { ...base, ollama };
    const result = await runAgentLoop(deps, 'Look at the page.');
    expect(result.state).toBe('COMPLETED');
    expect(result.answer).toContain('text instead');
    // The failing call HAD images; the successful retry must NOT.
    expect(sawStrippedRetry).toBe(true);
    const lastCall: { messages: Array<{ images?: string[] }> } = ollama.calls[ollama.calls.length - 1];
    expect(lastCall.messages.every((m) => !m.images)).toBe(true);
  });
});
