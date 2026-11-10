import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';

test('Internal pages reject cross-origin API writes and iframe access', { timeout: 60_000 }, async t => {
  const app = new AppHandle();
  t.after(() => app.stop());
  await app.launch();
  const shell = app.chromePage();
  await shell.waitForSelector('.commandbar__input');
  const invoke = (command, args) => shell.evaluate(
    ([name, input]) => window.__TAURI_INTERNALS__.invoke(name, input), [command, args],
  );
  await invoke('browser_tabs_open', { req: { url: 'pab://darkweb', activate: true } });
  const internal = await app.waitTabPage(/pab\.darkweb|pab\.localhost\/darkweb/);
  await internal.waitForSelector('#tor-pill');
  const settingsUrl = await internal.evaluate(() => new URL('/api/settings', location.href).href);
  assert.equal(await internal.evaluate(async () => (await fetch('/api/settings')).status), 200);
  const internalIpc = await internal.evaluate(async () => {
    if (!window.__TAURI_INTERNALS__?.invoke) return false;
    return window.__TAURI_INTERNALS__.invoke('app_version').then(() => true, () => false);
  });
  await invoke('browser_tabs_open', { req: { url: fixtureServer.url('/static'), activate: true } });
  const attacker = await app.waitTabPage(/\/static$/);
  await attacker.evaluate(async ({ settingsUrl, pageUrl }) => {
    await fetch(settingsUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ storeSearchHistory: true }),
    }).catch(() => {});
    const frame = document.createElement('iframe');
    frame.src = pageUrl;
    await new Promise(resolve => {
      frame.onload = resolve;
      document.body.append(frame);
    });
  }, { settingsUrl, pageUrl: internal.url() });
  const config = path.join(app.dataRoot, 'darkweb', 'darkweb-config.json');
  assert.equal(existsSync(config), false, 'A cross-origin request wrote internal settings');
  assert.equal(internalIpc, false, 'A content WebView called an application command');
  const framed = attacker.frames().find(frame => frame.url() === internal.url());
  if (framed) assert.equal(await framed.locator('#tor-pill').count(), 0, 'A remote page framed the internal UI');
  await attacker.evaluate(() => { location.href = 'http://pab.search/?q=external-synthetic&src=research'; });
  await attacker.waitForURL(/pab\.search|pab\.localhost\/search/);
  assert.equal(await invoke('control_get_mode'), 'HUMAN');
});
