import assert from 'node:assert/strict';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer, startFixtures } from '../../scripts/e2e/fixtures/server.mjs';

async function invokeOn(app) {
  const shell = app.chromePage();
  await shell.waitForSelector('.commandbar__input');
  return (command, args) => shell.evaluate(
    ([name, input]) => window.__TAURI_INTERNALS__.invoke(name, input), [command, args],
  );
}

test('Proton VPN is the sole VPN panel and onion tabs require Tor', { timeout: 60_000 }, async t => {
  const app = new AppHandle();
  t.after(() => app.stop());
  await app.launch({ envOverrides: { HAYDEV_NO_ENGINES: '1' } });
  const invoke = await invokeOn(app);
  const routes = await invoke('windows_route_status');
  for (const route of [routes.ipv4, routes.ipv6]) {
    assert.ok(route === null || (Number.isInteger(route.index) && route.index > 0 && route.name.length));
  }
  const before = await invoke('browser_tabs_list');
  const code = await app.chromePage().evaluate(() => window.__TAURI_INTERNALS__
    .invoke('browser_tabs_open', { req: { url: 'http://' + 'a'.repeat(56) + '.onion/' } })
    .then(() => null, error => error.code));
  assert.equal(code, 'EGRESS_UNAVAILABLE');
  assert.deepEqual((await invoke('browser_tabs_list')).map(tab => tab.id), before.map(tab => tab.id));
  for (const command of ['arman_vpn_status', 'tor_open_tab']) {
    const rejected = await app.chromePage().evaluate(name =>
      window.__TAURI_INTERNALS__.invoke(name).then(() => false, () => true), command);
    assert.equal(rejected, true);
  }
  const shell = app.chromePage();
  assert.equal(await shell.getByRole('button', { name: 'HayDevVPN', exact: true }).count(), 0);
  await shell.getByRole('button', { name: 'Proton VPN', exact: true }).click();
  await shell.getByRole('region', { name: 'Proton VPN', exact: true })
    .getByRole('button', { name: 'Get Proton VPN Free', exact: true }).waitFor();
  await app.chromePage().getByRole('button', { name: 'Check Windows routes' }).click();
  await app.chromePage().getByText(/^IPv4 —/).waitFor();
  console.log(JSON.stringify({ routeTable: routes, torNotReady: code }));
});

test('Managed runtime can start again after a stop and a later stop cancels startup', {
  timeout: 45000,
}, async t => {
  const app = new AppHandle();
  t.after(() => app.stop());
  await startFixtures();
  await app.launch({ envOverrides: {
    HAYDEV_NO_ENGINES: '0',
    PAB_TOR_MODE: 'external',
    PAB_TOR_SOCKS_PORT: '1',
    PAB_SEARXNG_URL: fixtureServer.url('/searxng'),
    PAB_PERPLEXICA_URL: fixtureServer.url(''),
  } });
  const invoke = await invokeOn(app);
  async function ready() {
    const deadline = Date.now() + 10000;
    let status;
    do {
      status = await invoke('runtime_manager_status');
      if (status.searxng.state === 'READY' && status.perplexica.state === 'READY') return status;
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    assert.fail('Managed endpoints did not return to READY: ' + JSON.stringify(status));
  }
  async function stopped() {
    const status = await invoke('runtime_manager_status');
    assert.equal(status.searxng.state, 'STOPPED');
    assert.equal(status.perplexica.state, 'STOPPED');
    assert.equal(status.tor.state, 'STOPPED');
  }
  await invoke('privacy_status');
  await stopped();
  assert.equal(await invoke('runtime_manager_start'), true);
  await ready();
  assert.equal(await invoke('runtime_manager_stop'), true);
  await stopped();
  assert.equal(await invoke('runtime_manager_start'), true);
  const restarted = await ready();
  assert.equal(restarted.searxng.source, 'external');
  assert.equal(restarted.perplexica.source, 'external');

  await invoke('runtime_manager_stop');
  await invoke('runtime_manager_start');
  await invoke('runtime_manager_stop');
  await new Promise(resolve => setTimeout(resolve, 700));
  await stopped();
  assert.equal(await invoke('runtime_manager_start'), true);
  await ready();
});



test('Bundled Tor searches VormWeb, opens onion results and recovers after loss of service', {
  skip: process.env.HAYDEV_LIVE_TOR !== '1' ? 'live bundled Tor check is opt-in' : false,
  timeout: 240_000,
}, async t => {
  const app = new AppHandle();
  t.after(async () => {
    if (app.dataRoot) {
      const torLog = path.join(app.dataRoot, 'runtime', 'logs', 'tor.log');
      if (existsSync(torLog)) copyFileSync(torLog, path.join(app.evidenceDir, 'tor.log'));
    }
    await app.stop({ runDir: app.evidenceDir });
  });
  await startFixtures();
  await app.launch({ envOverrides: {
    HAYDEV_NO_ENGINES: '0',
    PAB_TOR_MODE: '',
    PAB_TOR_PATH: '',
    PAB_SEARXNG_URL: fixtureServer.url('/searxng'),
    PAB_PERPLEXICA_URL: fixtureServer.url(''),
    HTTPS_PROXY: 'http://127.0.0.1:1',
  } });
  const invoke = await invokeOn(app);
  const shell = app.chromePage();
  const torBlog = 'http://pzhdfe7jraknpj2qgu5cz2u3i4deuyfwmonvzu5i3nyw4t4bmg7o5pad.onion/';
  const directBlog = torBlog + '?source=address';
  const list = () => invoke('browser_tabs_list');
  async function untilReady() {
    const end = Date.now() + 80_000;
    let tor;
    while (Date.now() < end) {
      ({ tor } = await invoke('runtime_manager_status'));
      if (tor.state === 'READY') return tor;
      if (tor.state === 'FAILED') assert.fail('Bundled Tor failed: ' + tor.errorCode);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.fail('Bundled Tor did not report READY: ' + JSON.stringify(tor));
  }
  async function waitForPage(tabId, titlePart) {
    const end = Date.now() + 25_000;
    let title;
    while (Date.now() < end) {
      title = await invoke('browser_evaluate', { req: { tabId, expression: 'document.title' } }).catch(() => '');
      if (typeof title === 'string' && title.toLowerCase().includes(titlePart.toLowerCase())) return title;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const tab = (await list()).find(tab => tab.id === tabId);
    assert.fail('Expected onion content for ' + titlePart + ', last title was ' + title
      + ', navigation ' + JSON.stringify({ state: tab?.loadState, error: tab?.error }));
  }

  await invoke('browser_tabs_open', { req: { url: 'pab://darkweb', activate: true } });
  const page = await app.waitTabPage(/pab\.darkweb|pab\.localhost\/darkweb/);
  await page.getByText('VormWeb (Tor)', { exact: true }).waitFor();
  const initialTor = await untilReady();

  await page.locator('#input').fill('Tor Blog');
  await page.locator('#go').click();
  const resultHref = '/open?url=' + encodeURIComponent(torBlog);
  const result = page.locator('.card .t a').filter({ hasText: 'Tor Blog | The Tor Project' })
    .and(page.locator('a[href="' + resultHref + '"]')).first();
  await result.waitFor({ timeout: 30000 });
  assert.equal(await result.getAttribute('href'), resultHref);
  await result.click();
  await shell.waitForFunction(url => window.__TAURI_INTERNALS__.invoke('browser_tabs_list')
    .then(tabs => tabs.some(tab => tab.isDarkWeb && (tab.url === url || tab.pendingUrl === url))), torBlog);
  const resultTab = (await list()).find(tab => tab.isDarkWeb && (tab.url === torBlog || tab.pendingUrl === torBlog));
  assert.equal(resultTab.profile, 'darkweb');
  assert.match(resultTab.egress, /^socks5:\/\/127\.0\.0\.1:/);

  const resultTitle = await waitForPage(resultTab.id, 'Tor Blog');

  // A bare .onion pasted into the DarkWeb field opens an isolated tab directly.
  await shell.evaluate(() => window.__TAURI_INTERNALS__.invoke('browser_tabs_list').then(tabs => {
    const darkweb = tabs.find(tab => !tab.isDarkWeb && (tab.url?.includes('darkweb') || tab.pendingUrl?.includes('darkweb')));
    return window.__TAURI_INTERNALS__.invoke('browser_tabs_activate', { req: { tabId: darkweb.id } });
  }));
  await page.locator('#input').fill(directBlog.slice('http://'.length));
  await page.locator('#go').click();
  await shell.waitForFunction(url => window.__TAURI_INTERNALS__.invoke('browser_tabs_list')
    .then(tabs => tabs.some(tab => tab.isDarkWeb && (tab.url === url || tab.pendingUrl === url))), directBlog);
  const blogTab = (await list()).find(tab => tab.isDarkWeb && (tab.url === directBlog || tab.pendingUrl === directBlog));
  assert.equal(blogTab.egress, resultTab.egress);
  const title = await waitForPage(blogTab.id, 'Tor Blog');

  await invoke('runtime_manager_stop');
  await invoke('browser_navigate', { req: { tabId: blogTab.id, url: torBlog + '?cycle=down' } });
  await shell.waitForFunction(tabId => window.__TAURI_INTERNALS__.invoke('browser_tabs_list')
    .then(tabs => tabs.some(tab => tab.id === tabId && tab.loadState === 'error')), blogTab.id, { timeout: 15000 });

  await invoke('runtime_manager_start');
  const recoveredTor = await untilReady();
  assert.notEqual(recoveredTor.pid, initialTor.pid);
  await invoke('browser_navigate', { req: { tabId: blogTab.id, url: torBlog + '?cycle=recovered' } });
  await waitForPage(blogTab.id, 'Tor Blog');
  assert.equal((await list()).find(tab => tab.id === blogTab.id).egress, blogTab.egress);
  console.log(JSON.stringify({ liveProvider: 'VormWeb', openedResult: resultTitle, onionPage: title,
    isolated: true, missingTor: 'blocked', restartedTor: true, sameTabRecovered: true }));
});
