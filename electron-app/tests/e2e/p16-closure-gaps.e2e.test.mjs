import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';
const pause = ms => new Promise(r => setTimeout(r, ms));
const invoke = (page, c, a = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [c, a]);
async function until(f, message) { const end = Date.now() + 15000; do { if (await f()) return; await pause(100); } while (Date.now() < end); assert.fail(message); }

// R01 gap: NavStack::to_session/from_session existed but the session store
// saved an empty navigation and bootstrap_session never restored the stack.
test('P16: navigation stack survives restart; restored back/forward actually navigate', { timeout: 150000 }, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'haydev-e2e-navstack-')); let app = new AppHandle();
  t.after(async () => { await app.stop(); rmSync(root, { recursive: true, force: true }); });
  writeFileSync(path.join(root, 'privacy.json'), JSON.stringify({ privateEgress: 'direct' }));
  await app.launch({ dataRoot: root });
  let chrome = app.chromePage(); await chrome.waitForSelector('.commandbar__input');
  const open = await invoke(chrome, 'browser_tabs_open', { req: { url: fixtureServer.url('/static?n=1'), activate: true } });
  const tabId = open.tabId ?? open.id ?? open;
  await app.waitTabPage(/\?n=1/);
  await invoke(chrome, 'browser_navigate', { req: { tabId, url: fixtureServer.url('/static?n=2') } });
  await app.waitTabPage(/\?n=2/);
  await invoke(chrome, 'browser_navigate', { req: { tabId, url: fixtureServer.url('/static?n=3') } });
  await app.waitTabPage(/\?n=3/);
  // persist_session runs on every page-load commit; require the real stack.
  await until(() => {
    try {
      const tabs = JSON.parse(readFileSync(path.join(root, 'session.json'))).tabs;
      const nav = tabs.find(x => x.url.includes('n=3'))?.navigation;
      return nav && nav.backStack.length === 2 && nav.current?.includes('n=3');
    } catch { return false; }
  }, 'session.json must carry the committed back stack');
  await app.stop({ graceful: true });

  app = new AppHandle(); await app.launch({ dataRoot: root });
  chrome = app.chromePage(); await chrome.waitForSelector('.commandbar__input');
  await until(async () => (await invoke(chrome, 'browser_tabs_list')).some(x => x.url.includes('n=3')), 'restored tab missing');
  // The restored stack must surface back availability before any new commit.
  await until(async () => (await invoke(chrome, 'browser_tabs_list')).find(x => x.url.includes('n=3'))?.canGoBack === true,
    'restored tab must report canGoBack from the persisted stack');
  await invoke(chrome, 'browser_back', { req: { tabId } });
  await app.waitTabPage(/\?n=2/);
  // Back/forward flags update optimistically at press time — wait for the
  // landing page to actually finish committing before pressing forward.
  await page2Complete(app, /\?n=2/);
  await invoke(chrome, 'browser_forward', { req: { tabId } });
  await app.waitTabPage(/\?n=3/);
  await page2Complete(app, /n=3/);
  // In-session hop after restore: new page enters the native window.
  await invoke(chrome, 'browser_navigate', { req: { tabId, url: fixtureServer.url('/static?n=4') } });
  await app.waitTabPage(/\?n=4/);
  await page2Complete(app, /n=4/);
  await invoke(chrome, 'browser_back', { req: { tabId } });
  await app.waitTabPage(/\?n=3/);
});

/** The tab page matching the pattern finished loading its document. */
async function page2Complete(app, pattern) {
  const page = await app.waitTabPage(pattern);
  await page.waitForFunction(() => document.readyState === 'complete', undefined, { timeout: 15000 });
  await pause(400);
}

// R01 gap: navigation/reload between a vault fill request and its execution,
// including the same-URL case — the fill must never populate a stale document.
test('P16: vault fill raced by a same-URL reload leaves the fresh document unfilled and stays recoverable', { timeout: 90000 }, async t => {
  const app = new AppHandle(); t.after(() => app.stop()); await app.launch();
  const chrome = app.chromePage(); await chrome.waitForSelector('.commandbar__input');
  const saved = await invoke(chrome, 'vault_save', { input: { domain: '127.0.0.1', username: 'synthetic-user', password: 'synthetic-reload-secret' } });
  const open = await invoke(chrome, 'browser_tabs_open', { req: { url: fixtureServer.url('/login'), activate: true } });
  const tabId = open.tabId ?? open.id ?? open;
  const page = await app.waitTabPage(/\/login/);
  await page.waitForSelector('#fixture-login');
  const firstId = await page.evaluate(() => window.__haydevDocumentId);
  // Reload the SAME URL while the fill is in flight.
  await page.evaluate(() => {
    const query = document.querySelector.bind(document); let fired = false;
    document.querySelector = (s) => { if (!fired) { fired = true; location.reload(); } return query(s); };
  });
  const outcome = await chrome.evaluate(async input => {
    try {
      const raced = await Promise.race([
        window.__TAURI_INTERNALS__.invoke('vault_fill', { input }),
        new Promise(res => setTimeout(() => res({ raced: 'timeout' }), 8000)),
      ]);
      return { ok: true, raced };
    } catch (error) { return { rejected: String(error?.code ?? error?.message ?? error) }; }
  }, { id: saved.record.id, tabId });
  // The page settles on a NEW document instance at the same URL.
  await page.waitForSelector('#fixture-login');
  await until(async () => (await page.evaluate(() => window.__haydevDocumentId)) !== firstId, 'reload must produce a fresh document identity');
  assert.equal(await page.inputValue('#fixture-pass'), '', 'no credential may appear on the document the user reloaded');
  assert.equal(await page.inputValue('#fixture-user'), '');
  if (outcome.rejected) assert.match(outcome.rejected, /VAULT_DOCUMENT_CHANGED/, 'a failed race must keep its diagnostic code');
  // Recovery: an explicit second fill on the settled document works normally.
  const second = await invoke(chrome, 'vault_fill', { input: { id: saved.record.id, tabId } });
  assert.equal(second.success, true);
  assert.equal(await page.inputValue('#fixture-user'), 'synthetic-user');
});

// R01 gap: corrupt vault/settings stores must preserve the corrupt original,
// surface a safe diagnostic, and recover once the file is removed.
test('P16: corrupt credentials.vault and privacy.json are preserved, surfaced, and recoverable', { timeout: 90000 }, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'haydev-e2e-corrupt-')); let app = new AppHandle();
  t.after(async () => { await app.stop(); rmSync(root, { recursive: true, force: true }); });
  const vaultCorrupt = '{"version":1,"records":[ BROKEN';
  const privacyCorrupt = '{ "privateEgress": DIRECT BROKEN';
  writeFileSync(path.join(root, 'credentials.vault'), vaultCorrupt);
  writeFileSync(path.join(root, 'privacy.json'), privacyCorrupt);
  await app.launch({ dataRoot: root });
  const chrome = app.chromePage(); await chrome.waitForSelector('.commandbar__input', { timeout: 30000 });
  const listed = await chrome.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke('vault_list'); return { ok: true }; }
    catch (error) { return { code: String(error?.code ?? error?.message ?? error) }; }
  });
  assert.match(listed.code ?? '', /STORE_CORRUPT/, 'vault listing must surface the corruption code');
  assert.equal(readFileSync(path.join(root, 'credentials.vault'), 'utf8'), vaultCorrupt, 'corrupt vault original must not be overwritten');
  assert.equal(readFileSync(path.join(root, 'privacy.json'), 'utf8'), privacyCorrupt, 'corrupt privacy original must not be overwritten');
  // The browser stays functional; only the damaged store refuses.
  assert.ok((await invoke(chrome, 'browser_tabs_list')).length >= 1);
  await app.stop();
  // Recovery: after the operator removes the damaged vault, listing works.
  rmSync(path.join(root, 'credentials.vault'));
  app = new AppHandle(); await app.launch({ dataRoot: root });
  const chrome2 = app.chromePage(); await chrome2.waitForSelector('.commandbar__input', { timeout: 30000 });
  const again = await chrome2.evaluate(async () => {
    try { const r = await window.__TAURI_INTERNALS__.invoke('vault_list'); return { ok: true, count: (r.credentials ?? r).length }; }
    catch (error) { return { code: String(error?.code ?? error?.message ?? error) }; }
  });
  assert.equal(again.ok, true, 'vault must work after the corrupt file is removed');
  assert.equal(again.count, 0);
});

// R01 gap: Shield enable/allowlist persistence after restart, and honest
// protectedTabs accounting when the protected surface goes away.
test('P16: Shield config persists across restart; protectedTabs tracks the concrete webview', { timeout: 120000 }, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'haydev-e2e-shield-')); let app = new AppHandle();
  t.after(async () => { await app.stop(); rmSync(root, { recursive: true, force: true }); });
  writeFileSync(path.join(root, 'privacy.json'), JSON.stringify({ privateEgress: 'direct' }));
  await app.launch({ dataRoot: root });
  let chrome = app.chromePage(); await chrome.waitForSelector('.commandbar__input');
  // Disabled is the discriminating direction: a fresh profile defaults to
  // enabled, so persistence must keep an explicit OFF across restart.
  assert.equal((await invoke(chrome, 'shield_set_enabled', { enabled: false })).accepted, true);
  assert.equal((await invoke(chrome, 'shield_allow_site', { host: 'allowme.example' })).accepted, true);
  const baseline = (await invoke(chrome, 'shield_status')).protectedTabs;
  const open = await invoke(chrome, 'browser_tabs_open', { req: { url: fixtureServer.url('/static?shield=1'), activate: true } });
  const tabId = open.tabId ?? open.id ?? open;
  await app.waitTabPage(/\?shield=1/);
  await until(async () => (await invoke(chrome, 'shield_status')).protectedTabs === baseline + 1, 'newly attached tab must raise the protected count');
  await invoke(chrome, 'browser_tabs_close', { req: { tabId } });
  await until(async () => (await invoke(chrome, 'shield_status')).protectedTabs === baseline, 'closed tab must leave the protected set');
  await app.stop({ graceful: true });

  app = new AppHandle(); await app.launch({ dataRoot: root });
  chrome = app.chromePage(); await chrome.waitForSelector('.commandbar__input');
  const after = await invoke(chrome, 'shield_status');
  assert.equal(after.enabled, false, 'explicit Shield OFF must survive restart');
  assert.ok(after.allowlist.includes('allowme.example'), 'allowlist must survive restart');
});
