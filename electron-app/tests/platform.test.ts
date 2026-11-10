import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

describe('platform tauri adapter', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it('routes the renderer platform entry point to Tauri IPC', async () => {
    const { platformApi } = await import('../src/renderer/src/platform');
    invokeMock.mockResolvedValue({ appVersion: 'fixture' });
    await expect(platformApi.getVersion()).resolves.toEqual({ appVersion: 'fixture' });
    expect(invokeMock).toHaveBeenCalledWith('app_version');
  });

  it('unsubscribes if the panel closes before native listen resolves', async () => {
    const { tauriApi } = await import('../src/renderer/src/platform/tauri');
    let resolveListen!: (off: () => void) => void;
    listenMock.mockImplementationOnce(() => new Promise<() => void>(r => { resolveListen = r; }));
    const dispose = tauriApi.on('agent:state:update', () => {});
    dispose();
    const unlisten = vi.fn(); resolveListen(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledOnce();
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
