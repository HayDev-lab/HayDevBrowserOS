/**
 * Platform abstraction layer tests (migration Phase 2).
 *
 * Covers: runtime detection, the Electron bridge proxy (window.api), and the
 * Tauri adapter's command mapping + push-channel allowlist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

describe('platform runtime detection', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.resetModules();
    globalThis.window = originalWindow;
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  function freshWindowFixture(props: Record<string, unknown>): void {
    // @ts-expect-error test fixture replaces the global
    globalThis.window = { ...props };
  }

  it('detects Tauri when __TAURI_INTERNALS__ is injected', async () => {
    freshWindowFixture({ __TAURI_INTERNALS__: {} });
    const { detectRuntime } = await import('../src/renderer/src/platform');
    expect(detectRuntime()).toBe('tauri');
  });

  it('detects Electron when only window.api exists', async () => {
    freshWindowFixture({ api: { getVersion: () => Promise.resolve({}) } });
    const { detectRuntime } = await import('../src/renderer/src/platform');
    expect(detectRuntime()).toBe('electron');
  });

  it('falls back to the electron adapter without any runtime marker', async () => {
    freshWindowFixture({});
    const { runtime } = await import('../src/renderer/src/platform');
    expect(runtime).toBe('electron');
  });

  it('exposes the electron bridge through platformApi (no circular proxy)', async () => {
    const getVersion = () => Promise.resolve({ electron: 'test', chrome: '', node: '', appVersion: '1' });
    freshWindowFixture({ api: { getVersion } });
    const { platformApi } = await import('../src/renderer/src/platform');
    await expect(platformApi.getVersion()).resolves.toEqual({
      electron: 'test',
      chrome: '',
      node: '',
      appVersion: '1',
    });
  });

  it('returns undefined for surfaces the bridge does not expose', async () => {
    freshWindowFixture({ api: {} });
    const { electronApi } = await import('../src/renderer/src/platform/electron');
    expect((electronApi as unknown as Record<string, unknown>).nonexistent).toBeUndefined();
  });
});

describe('platform tauri adapter', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it('maps browser methods to snake_case commands with wrapped args', async () => {
    const { tauriApi } = await import('../src/renderer/src/platform/tauri');
    invokeMock.mockResolvedValue([]);

    await tauriApi.browser.listTabs();
    expect(invokeMock).toHaveBeenCalledWith('browser_tabs_list');

    await tauriApi.browser.openTab({ url: 'https://example.com' });
    expect(invokeMock).toHaveBeenCalledWith('browser_tabs_open', {
      req: { url: 'https://example.com' },
    });

    await tauriApi.browser.closeTab('tab_1');
    expect(invokeMock).toHaveBeenCalledWith('browser_tabs_close', {
      req: { tabId: 'tab_1' },
    });

    await tauriApi.browser.deleteHistory('hist_1');
    expect(invokeMock).toHaveBeenCalledWith('browser_history_delete', { id: 'hist_1' });
  });

  it('maps agent/control/vault/window surfaces', async () => {
    const { tauriApi } = await import('../src/renderer/src/platform/tauri');
    invokeMock.mockResolvedValue(undefined);

    await tauriApi.agent.stop('user');
    expect(invokeMock).toHaveBeenCalledWith('agent_stop', { reason: 'user' });

    await tauriApi.control.setMode('AGENT');
    expect(invokeMock).toHaveBeenCalledWith('control_set_mode', { mode: 'AGENT' });

    await tauriApi.vault.delete('cred_1');
    expect(invokeMock).toHaveBeenCalledWith('vault_delete', { id: 'cred_1' });

    await tauriApi.window.minimize();
    expect(invokeMock).toHaveBeenCalledWith('window_minimize');
  });

  it('subscribes only to allowlisted push channels', async () => {
    const { tauriApi } = await import('../src/renderer/src/platform/tauri');
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    // Allowed channel → listen() is used.
    const dispose = tauriApi.on('agent:state:update', () => {});
    expect(listenMock).toHaveBeenCalledWith('agent:state:update', expect.any(Function));

    // Disallowed channel → silent noop unsubscribe, no listen() call.
    const callsBefore = listenMock.mock.calls.length;
    const dispose2 = tauriApi.on('evil:channel', () => {});
    expect(listenMock.mock.calls.length).toBe(callsBefore);
    expect(typeof dispose2).toBe('function');
    dispose2();

    dispose();
  });
});
