import assert from 'node:assert/strict';
import test from 'node:test';
import { AppHandle } from '../../scripts/e2e/harness.mjs';

async function invokeOn(app) {
  const shell = app.chromePage();
  await shell.waitForSelector('.commandbar__input');
  return (command, args) => shell.evaluate(
    ([name, input]) => window.__TAURI_INTERNALS__.invoke(name, input), [command, args],
  );
}

test('Windows route diagnostics and Tor pre-bootstrap refusal', { timeout: 60_000 }, async t => {
  const app = new AppHandle();
  t.after(() => app.stop());
  await app.launch({ envOverrides: { HAYDEV_NO_ENGINES: '1' } });
  const invoke = await invokeOn(app);
  const routes = await invoke('windows_route_status');
  for (const route of [routes.ipv4, routes.ipv6]) {
    assert.ok(route === null || (Number.isInteger(route.index) && route.index > 0 && route.name.length));
  }
  const before = await invoke('browser_tabs_list');
  const error = await invoke('tor_open_tab', { url: 'https://example.com/' }).catch(error => error);
  assert.equal(error.code, 'TOR_TAB_NOT_READY');
  assert.deepEqual((await invoke('browser_tabs_list')).map(tab => tab.id), before.map(tab => tab.id));
  await app.chromePage().getByRole('button', { name: 'HayDevVPN', exact: true }).click();
  await app.chromePage().getByText('VPN for Windows', { exact: true }).click();
  await app.chromePage().getByRole('button', { name: 'Check Windows routes' }).click();
  await app.chromePage().getByText(/^IPv4 —/).waitFor();
  console.log(JSON.stringify({ routeTable: routes, torNotReady: error.code }));
});

test('Bundled Tor exit, loss of service and recovery through the same tab', {
  skip: process.env.HAYDEV_LIVE_TOR !== '1' ? 'live bundled Tor check is opt-in' : false,
  timeout: 240_000,
}, async t => {
  const app = new AppHandle();
  t.after(() => app.stop({ runDir: app.evidenceDir }));
  await app.launch({ envOverrides: { HAYDEV_NO_ENGINES: '0', PAB_TOR_MODE: '', PAB_TOR_PATH: '' } });
  const invoke = await invokeOn(app);
  async function untilReady() {
    const end = Date.now() + 80_000;
    while (Date.now() < end) {
      const { tor } = await invoke('runtime_manager_status');
      if (tor.state.toLowerCase() === 'ready') return;
      if (tor.state.toLowerCase() === 'failed') throw Error(tor.errorCode ?? 'Tor bootstrap failed');
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    throw Error('Bundled Tor did not report READY');
  }
  async function isTor(tabId) {
    try {
      return await invoke('browser_evaluate', { req: { tabId, expression:
        'location.hostname === "check.torproject.org" && JSON.parse(document.body.innerText).IsTor === true',
      } });
    } catch {
      return false;
    }
  }
  async function waitForTorExit(tabId) {
    const end = Date.now() + 20_000;
    while (Date.now() < end) {
      if (await isTor(tabId)) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.fail('Tor exit was not confirmed by check.torproject.org');
  }
  await untilReady();
  const endpoint = 'https://check.torproject.org/api/ip';
  const tabId = await invoke('tor_open_tab', { url: endpoint });
  await waitForTorExit(tabId);
  assert.ok((await invoke('browser_tabs_list')).some(tab => tab.id === tabId && tab.isIncognito && tab.profile === 'tor-proxy'));
  await invoke('runtime_manager_stop');
  await invoke('browser_navigate', { req: { tabId, url: endpoint + '?cycle=down' } });
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    const tab = (await invoke('browser_tabs_list')).find(tab => tab.id === tabId);
    if (tab.loadState.toLowerCase() === 'error') break;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  const stopped = (await invoke('browser_tabs_list')).find(tab => tab.id === tabId);
  assert.equal(stopped.loadState.toLowerCase(), 'error');
  await invoke('runtime_manager_start');
  await untilReady();
  await invoke('browser_navigate', { req: { tabId, url: endpoint + '?cycle=recovered' } });
  await waitForTorExit(tabId);
  console.log(JSON.stringify({ torExit: true, missingTunnel: 'blocked', recovered: true }));
});
