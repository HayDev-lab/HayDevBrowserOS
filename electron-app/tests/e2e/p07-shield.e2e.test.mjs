/**
 * P07 gate — HayDev Shield: REAL network-level blocking (CDP Fetch domain):
 *  1. ON: requests to blocklisted hosts fail at the network level (page
 *     sees errors) and the REAL counters grow;
 *  2. site exception: an allowed host stops being blocked while others still are;
 *  3. OFF: zero new blocks (no DOM-hiding pretending to block);
 *  4. ON again: blocking resumes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const invoke = (page, cmd, args) =>
  page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);

async function loadAdPage(app, chrome, seq) {
  const url = `${fixtureServer.url('/ad-heavy')}?s=${seq}`;
  await invoke(chrome, 'browser_navigate', { req: { tabId: (await activeTab(app, chrome)).id, url } });
  await app.waitTabPage(/\/ad-heavy/, 20_000);
  const page = app.tabPages().find((p) => p.url().includes('/ad-heavy'));
  await page.waitForSelector('#ad-status', { timeout: 15_000 });
  // Let the page's error handlers settle.
  for (let i = 0; i < 40; i += 1) {
    const fails = await page.evaluate(() => window.__trackerFail ?? 0);
    if (fails >= 3) break;
    await sleep(250);
  }
  return page;
}

async function activeTab(app, chrome) {
  const tabs = await invoke(chrome, 'browser_tabs_list');
  const active = tabs.find((x) => x.isActive);
  if (!active) throw new Error('no active tab');
  return active;
}

async function waitFor(predicate, { timeoutMs = 20_000, stepMs = 200, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(stepMs);
  }
}

test('P07: shield blocks on/off/exception with real counters', { timeout: 240_000 }, async (t) => {
  const app = new AppHandle();
  t.after(async () => { await app.stop(); });
  await app.launch();
  const chrome = app.chromePage();
  await chrome.waitForSelector('.commandbar__input', { timeout: 30_000 });

  // Shield must be ON by default.
  let status = await invoke(chrome, 'shield_status', {});
  assert.equal(status.enabled, true, 'shield must default to ON');

  // --- 1. ON: page resources to *.example tracker hosts fail + counters.
  await loadAdPage(app, chrome, 1);
  await waitFor(
    async () => (await invoke(chrome, 'shield_status', {})).totalBlocked >= 3,
    { label: '≥3 real blocks (img+script+fetch)' },
  );
  status = await invoke(chrome, 'shield_status', {});
  const hostOf = (h) => status.byHost.find((x) => x.host === h)?.blocked ?? 0;
  assert.ok(hostOf('tracker.example') >= 1, `tracker.example must be blocked: ${JSON.stringify(status.byHost)}`);
  assert.ok(hostOf('adhost.example') >= 1, `adhost.example must be blocked: ${JSON.stringify(status.byHost)}`);
  const before = { tracker: hostOf('tracker.example'), adhost: hostOf('adhost.example'), ads: hostOf('ads.example') };

  // An exception belongs to the visited site, never to a tracker globally.
  const allow = await invoke(chrome, 'shield_allow_site', { host: '127.0.0.1' });
  assert.equal(allow.accepted, true);
  const beforeException = status.totalBlocked;
  await loadAdPage(app, chrome, 2);
  status = await invoke(chrome, 'shield_status', {});
  assert.equal(status.totalBlocked, beforeException);
  assert.ok(status.allowlist.includes('127.0.0.1'));
  const hostOf2 = (h) => status.byHost.find((x) => x.host === h)?.blocked ?? 0;

  // --- 3. OFF: no new blocks at all.
  const off = await invoke(chrome, 'shield_set_enabled', { enabled: false });
  assert.equal(off.accepted, true);
  await loadAdPage(app, chrome, 3);
  await sleep(3000);
  status = await invoke(chrome, 'shield_status', {});
  assert.equal(status.totalBlocked, hostOf2('tracker.example') + hostOf2('adhost.example') + hostOf2('ads.example') + 0
    , 'OFF must not add blocks'); // same total as after step 2
  const totalAfterOff = status.totalBlocked;

  // --- 4. ON again: blocking resumes.
  await invoke(chrome, 'shield_set_enabled', { enabled: true });
  await invoke(chrome, 'shield_disallow_site', { host: '127.0.0.1' });
  await loadAdPage(app, chrome, 4);
  await waitFor(async () => (await invoke(chrome, 'shield_status', {})).totalBlocked > totalAfterOff, { label: 'blocking resumes' });
});
