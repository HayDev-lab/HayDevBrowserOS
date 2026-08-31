/**
 * Incognito integration tests — AgentController + vault policy enforcement.
 *
 * Verifies:
 *   - AgentController.setIncognitoContext(true) sets the incognito flag
 *   - clearPrivateTimeline() empties the timeline
 *   - Transitioning out of incognito clears the timeline
 *   - vault.generate_and_store is denied in incognito context (via agent loop)
 *   - TAKE CONTROL works the same in incognito (doesn't destroy private state)
 */
import { describe, it, expect } from 'vitest';
import { AgentController } from '../src/main/browser/agent/runtime/agent-controller';
import {
  FakeOllamaClient,
  toolCallResponse,
  finalAnswerResponse,
} from './_fake-ollama';
import { FakeActionAdapter, defaultRawPage } from './_fake-adapter';
import { FakeTabManagement, makeFakeTab } from './_fake-tab-management';
import { FakeEncryptionAdapter, MemoryVaultStorageAdapter } from './_fake-vault';
import { CredentialVault } from '../src/main/browser/vault/runtime/credential-vault';
import { makeClock } from './_helpers';
import type { AgentTimelineEntry } from '@shared/agent-types';

// ---------------------------------------------------------------------------
// Fake BrowserActionService (reused from agent-controller tests)
// ---------------------------------------------------------------------------

class FakeBrowserActionService {
  public readonly dispatched: unknown[] = [];

  constructor(
    private adapter: FakeActionAdapter,
    private tabs: FakeTabManagement
  ) {}

  async dispatch(input: unknown): Promise<unknown> {
    this.dispatched.push(input);
    return { success: true, executionId: 'exec_test', completedAt: Date.now() };
  }
  startExecutionContext(): string { return 'exec_test'; }
  stopExecutionContext(): { executionId: string; aborted: boolean; cancelledCount: number } {
    return { executionId: 'exec_test', aborted: true, cancelledCount: 0 };
  }
  dispose(): void {}
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupController(opts: { incognito?: boolean; responses?: string[] } = {}) {
  const ollama = new FakeOllamaClient({
    responses: opts.responses ?? [finalAnswerResponse('Done.')],
    configured: true,
  });
  const adapter = new FakeActionAdapter();
  adapter.configureTab('tab_1', { rawPage: defaultRawPage('https://example.com/') });
  const tabs = new FakeTabManagement([makeFakeTab({ id: 'tab_1', isIncognito: opts.incognito ?? false })]);
  const actions = new FakeBrowserActionService(adapter, tabs);
  const encryption = new FakeEncryptionAdapter();
  const storage = new MemoryVaultStorageAdapter();
  const vault = new CredentialVault({
    encryption,
    storage,
    resolveWebContents: () => null,
    now: makeClock(1_000_000),
  });
  const controller = new AgentController({
    ollama,
    actions: actions as unknown as InstanceType<typeof AgentController>['deps']['actions'],
    vault,
    callbacks: {
      onTimelineUpdate: () => {},
      onStateChange: () => {},
      onControlModeChange: () => {},
      onRunComplete: () => {},
    },
    now: makeClock(1_000_000),
  });
  return { controller, ollama, adapter, tabs, actions, encryption, storage, vault };
}

// ===========================================================================
// Incognito context
// ===========================================================================
describe('incognito-integration / agent controller context', () => {
  it('starts in regular (non-incognito) context', () => {
    const { controller } = setupController();
    expect(controller.isIncognitoContext()).toBe(false);
  });

  it('setIncognitoContext(true) sets incognito flag', () => {
    const { controller } = setupController();
    controller.setIncognitoContext(true);
    expect(controller.isIncognitoContext()).toBe(true);
  });

  it('setIncognitoContext(false) after true clears flag + timeline', () => {
    const { controller } = setupController();
    controller.setIncognitoContext(true);
    expect(controller.isIncognitoContext()).toBe(true);
    controller.setIncognitoContext(false);
    expect(controller.isIncognitoContext()).toBe(false);
    // Timeline should be cleared.
    expect(controller.getTimeline().length).toBe(0);
  });

  it('clearPrivateTimeline empties the timeline', async () => {
    const { controller } = setupController({
      responses: [
        toolCallResponse('tabs.list', {}),
        finalAnswerResponse('Done.'),
      ],
    });
    controller.setIncognitoContext(true);
    controller.setMode('AGENT');
    await controller.run({ command: 'List tabs.' });
    // Timeline should have entries from the run.
    expect(controller.getTimeline().length).toBeGreaterThan(0);
    // Clear private timeline.
    controller.clearPrivateTimeline();
    expect(controller.getTimeline().length).toBe(0);
  });
});

// ===========================================================================
// Vault generate denied in incognito
// ===========================================================================
describe('incognito-integration / vault generate denied', () => {
  it('vault.generate_and_store returns failure in incognito context', async () => {
    const { controller, storage } = setupController({
      incognito: true,
      responses: [
        toolCallResponse('vault.generate_and_store', {
          domain: 'example.com',
          username: 'user@example.com',
        }),
        finalAnswerResponse('Done.'),
      ],
    });
    controller.setIncognitoContext(true);
    controller.setMode('AGENT');
    const result = await controller.run({ command: 'Generate credential.' });

    // The vault should NOT have a new record (generate was denied).
    const records = await storage.read();
    expect(records.length).toBe(0);
  });

  it('vault.generate_and_store succeeds in regular context', async () => {
    const { controller, storage } = setupController({
      incognito: false,
      responses: [
        toolCallResponse('vault.generate_and_store', {
          domain: 'example.com',
          username: 'user@example.com',
        }),
        finalAnswerResponse('Done.'),
      ],
    });
    controller.setMode('AGENT');
    await controller.run({ command: 'Generate credential.' });

    // The vault should have a new record.
    const records = await storage.read();
    expect(records.length).toBe(1);
  });
});

// ===========================================================================
// TAKE CONTROL works in incognito
// ===========================================================================
describe('incognito-integration / TAKE CONTROL in incognito', () => {
  it('takeControl works in incognito context', async () => {
    const { controller, tabs } = setupController({
      incognito: true,
      responses: [
        toolCallResponse('tabs.list', {}),
        finalAnswerResponse('Done.'),
      ],
    });
    controller.setIncognitoContext(true);
    controller.setMode('AGENT');

    // TAKE CONTROL.
    const result = controller.takeControl('user_request');
    expect(result.accepted).toBe(true);
    expect(controller.getControlMode()).toBe('HUMAN');

    // Browser state preserved — tabs NOT closed.
    expect(tabs.listTabs().length).toBe(1);
  });

  it('incognito tab state is NOT destroyed by TAKE CONTROL', async () => {
    const { controller, tabs } = setupController({
      incognito: true,
      responses: [finalAnswerResponse('Done.')],
    });
    controller.setIncognitoContext(true);
    controller.setMode('AGENT');
    const tabCountBefore = tabs.listTabs().length;
    controller.takeControl('user_request');
    const tabCountAfter = tabs.listTabs().length;
    expect(tabCountAfter).toBe(tabCountBefore);
  });
});

// ===========================================================================
// Agent timeline not persisted
// ===========================================================================
describe('incognito-integration / timeline not persisted', () => {
  it('agent timeline is in-memory only and cleared on context end', async () => {
    const { controller } = setupController({
      incognito: true,
      responses: [finalAnswerResponse('Done.')],
    });
    controller.setIncognitoContext(true);
    controller.setMode('AGENT');
    await controller.run({ command: 'Do something.' });
    expect(controller.getTimeline().length).toBeGreaterThan(0);

    // End incognito context — timeline should be cleared.
    controller.setIncognitoContext(false);
    expect(controller.getTimeline().length).toBe(0);
  });
});

// ===========================================================================
// Regular session unaffected
// ===========================================================================
describe('incognito-integration / regular session unaffected', () => {
  it('regular context timeline persists across context changes', async () => {
    const { controller } = setupController({
      incognito: false,
      responses: [finalAnswerResponse('Done.')],
    });
    // Regular context — no incognito.
    controller.setMode('AGENT');
    await controller.run({ command: 'Do something.' });
    const timelineLength = controller.getTimeline().length;
    expect(timelineLength).toBeGreaterThan(0);

    // Switching to incognito should NOT clear the regular timeline
    // (it only clears when transitioning OUT of incognito).
    controller.setIncognitoContext(true);
    // Timeline still has entries (they were from the regular run).
    expect(controller.getTimeline().length).toBe(timelineLength);
  });
});
