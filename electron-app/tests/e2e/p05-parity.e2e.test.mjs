/**
 * P05 gate — full user-path parity:
 *  1. setLocale reaches the internal pages (per-locale prebuilt HTML),
 *     persisted across restart;
 *  2. MCP browser tools follow the host policy (read-only always;
 *     navigate only in AGENT mode, refused with a takeover latch);
 *  3. a 20-tab session survives restart (no private tabs restored);
 *  4. downloads use the separate P08 native byte/progress/cancellation gate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MCP_PORT = Number(process.env.HAYDEV_MCP_TEST_PORT || 27901);

const invoke = (page, cmd, args) =>
  page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);

async function mcpTools(token) {
  const r = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  return (await r.json())?.result?.tools?.map((x) => x.name) ?? [];
}

async function mcpCall(token, name, args) {
  const r = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await r.json();
  return { status: r.status, body };
}

test('P05: locales, MCP host policy, 20-tab restart, downloads', { timeout: 300_000 }, async (t) => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'haydev-e2e-p05-'));
  let app = new AppHandle();
  t.after(async () => {
    await app.stop().catch(() => {});
    rmSync(dataRoot, { recursive: true, force: true });
  });
  await app.launch({ dataRoot });
  const chrome = app.chromePage();
  await chrome.waitForSelector('.commandbar__input', { timeout: 30_000 });

  // --- 1. Locale: switch to RU, restart, the newtab page is served in ru.
  const localeResp = await invoke(chrome, 'set_locale', { locale: 'ru' });
  assert.equal(localeResp.accepted, true, 'set_locale must accept ru');
  const badLocale = await chrome.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke('set_locale', { locale: 'xx' }); return 'ok'; }
    catch (e) { return typeof e === 'string' ? e : JSON.stringify(e); }
  });
  assert.match(badLocale, /INVALID_LOCALE/, 'unknown locale must be refused');
  await app.stop();
  app = new AppHandle();
  await app.launch({ dataRoot });
  const chrome2 = app.chromePage();
  await chrome2.waitForSelector('.commandbar__input', { timeout: 30_000 });
  const newtabPage = await app.waitTabPage(/pab\.newtab|pab:\/\/newtab|newtab/, 30_000);
  await newtabPage.waitForFunction(() => document.documentElement.lang === 'ru');
  const lang = await newtabPage.locator('html').getAttribute('lang');
  assert.equal(lang, 'ru', `restored locale must serve the ru newtab page (got lang=${lang})`);

  // --- 2. MCP browser tools + host policy.
  const tokenPath = path.join(dataRoot, 'mcp-token');
  const deadline = Date.now() + 20_000;
  while (!existsSync(tokenPath) && Date.now() < deadline) await sleep(300);
  const token = readFileSync(tokenPath, 'utf8').trim();
  const tools = await mcpTools(token);
  for (const expected of ['browser_tabs_list', 'browser_active_tab_snapshot', 'browser_navigate', 'agent_status']) {
    assert.ok(tools.includes(expected), `tools/list must include ${expected}`);
  }
  const status = await mcpCall(token, 'agent_status', {});
  assert.equal(status.status, 200, 'agent_status must answer');
  const tabsRead = await mcpCall(token, 'browser_tabs_list', {});
  assert.equal(tabsRead.status, 200, 'tabs listing is read-only allowed');
  // navigate in HUMAN mode → denied by host policy
  const humanMode = await invoke(chrome2, 'control_get_mode', {});
  const navDenied = await mcpCall(token, 'browser_navigate', { url: fixtureServer.url('/static') });
  if (humanMode === 'HUMAN') {
    const text = JSON.stringify(navDenied.body);
    assert.ok(/denied_by_host_policy/.test(text), `navigate must be denied in HUMAN mode: ${text}`);
  }
  // AGENT mode → navigate allowed and actually moves the tab
  const mode = await invoke(chrome2, 'control_set_mode', { mode: 'AGENT' });
  assert.equal(mode.accepted, true);
  const navOk = await mcpCall(token, 'browser_navigate', { url: fixtureServer.url('/static?via=mcp') });
  assert.equal(navOk.status, 200, `navigate in AGENT mode must work: ${JSON.stringify(navOk.body).slice(0, 200)}`);
  await app.waitTabPage(/\/static/, 30_000);
  await invoke(chrome2, 'control_set_mode', { mode: 'HUMAN' });

  // --- 3. Twenty tabs + restart (private tabs never restore).
  for (let i = 0; i < 19; i += 1) {
    await invoke(chrome2, 'browser_tabs_open', { req: { url: 'pab://newtab', activate: false } });
  }
  const before = await invoke(chrome2, 'browser_tabs_list');
  assert.ok(before.length >= 20, `expected ≥20 tabs, got ${before.length}`);
  await invoke(chrome2, 'browser_tabs_open', { req: { url: 'pab://newtab', activate: true, incognito: true } });
  // Graceful quit so ExitRequested fires and the session persists.
  await app.stop({ graceful: true });
  app = new AppHandle();
  await app.launch({ dataRoot });
  const chrome3 = app.chromePage();
  await chrome3.waitForSelector('.commandbar__input', { timeout: 30_000 });
  // Session restore creates each tab's webview asynchronously — poll for
  // the full set instead of a fixed sleep.
  let restored = [];
  const restoreDeadline = Date.now() + 30_000;
  for (;;) {
    restored = await invoke(chrome3, 'browser_tabs_list');
    if (restored.length >= 20 || Date.now() > restoreDeadline) break;
    await sleep(400);
  }
  assert.ok(restored.length >= 20, `session must restore ≥20 tabs (got ${restored.length})`);
  assert.ok(
    restored.every((x) => !x.isIncognito),
    'private tabs must NEVER appear in the restored session',
  );

  // The separate P08 gate validates complete/cancel/fail and actual file bytes.
  const downloads = await invoke(chrome3, 'browser_downloads_list', {});
  assert.ok(Array.isArray(downloads));
});
