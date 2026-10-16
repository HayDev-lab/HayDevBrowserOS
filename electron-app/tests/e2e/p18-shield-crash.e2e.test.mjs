import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';
const pause = ms => new Promise(r => setTimeout(r, ms));
const invoke = (page, c, a = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [c, a]);
async function until(f, message) { const end = Date.now() + 20000; do { if (await f()) return; await pause(150); } while (Date.now() < end); assert.fail(message); }

/** Renderer pids of THIS instance's browser (data-root-scoped). */
const rendererPids = (root) => {
  const safe = String(root).replaceAll("'", "''");
  const ps = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*--type=renderer*' -and $_.CommandLine.Contains('" + safe + "') } | ForEach-Object { $_.ProcessId }";
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', timeout: 20000, windowsHide: true }).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
};

// N03: a REAL renderer crash (CDP Page.crash → WebView2 ProcessFailed) must
// drop the tab from the protected set, surface the failure honestly in the
// registry, and re-arm the native hooks at the START of the next navigation
// — before any protected request of the recovered document.
test('P18: renderer crash drops protection honestly and re-arms before the next navigation', { timeout: 120000 }, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'haydev-e2e-crash-')); const app = new AppHandle();
  t.after(async () => { await app.stop(); rmSync(root, { recursive: true, force: true }); });
  await app.launch({ dataRoot: root });
  const chrome = app.chromePage(); await chrome.waitForSelector('.commandbar__input');
  const baseline = (await invoke(chrome, 'shield_status')).protectedTabs;
  const before = new Set(rendererPids(path.join(root, 'profiles', 'default')));
  const open = await invoke(chrome, 'browser_tabs_open', { req: { url: fixtureServer.url('/static?crash-target=1'), activate: true } });
  const tabId = open.tabId ?? open.id ?? open;
  const page = await app.waitTabPage(/\?crash-target=1/);
  await page.waitForSelector('#fixture-marker');
  await until(async () => (await invoke(chrome, 'shield_status')).protectedTabs === baseline + 1,
    'the new tab must be protected');

  // REAL renderer failure: the fixture document got its own
  // msedgewebview2 --type=renderer process (new since the tab opened).
  // Kill that pid — WebView2 raises ProcessFailed (RenderProcessExited).
  // (Page.crash is not implemented by WebView2's CDP subset.)
  const victim = rendererPids(path.join(root, 'profiles', 'default')).find(pid => !before.has(pid));
  assert.ok(victim, 'a dedicated renderer process must exist for the new document');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Stop-Process -Id ${victim} -Force`], { timeout: 15000, windowsHide: true });

  // Honest state: the tab leaves the protected set and the registry carries
  // the native failure code — not a fabricated "still protected".
  await until(async () => (await invoke(chrome, 'shield_status')).protectedTabs === baseline,
    'crashed tab must leave the protected set');
  await until(async () => {
    const tab = (await invoke(chrome, 'browser_tabs_list')).find(x => x.id === tabId);
    return tab?.error === 'WEBVIEW_PROCESS_FAILED';
  }, 'registry must surface WEBVIEW_PROCESS_FAILED');

  // Recovery: the next navigation re-arms the hooks BEFORE the protected
  // document loads. Assert through the app's own state (a crashed renderer
  // gets a NEW CDP target, so Playwright page objects go stale): the tab is
  // protected again and the Shield keeps blocking for real on the recovered
  // document (ad-heavy's tracker hosts are in the blocklist).
  const blockedBefore = (await invoke(chrome, 'shield_status')).totalBlocked;
  await invoke(chrome, 'browser_navigate', { req: { tabId, url: fixtureServer.url('/ad-heavy?recover=1') } });
  await until(async () => {
    const s = await invoke(chrome, 'shield_status');
    return s.protectedTabs === baseline + 1 && s.totalBlocked > blockedBefore;
  }, 'recovered Shield must re-arm and keep blocking (real counters)');
  const after = await invoke(chrome, 'shield_status');
  const blockedHosts = (after.byHost ?? []).map(h => h.host);
  assert.ok(blockedHosts.some(h => /adhost\.example|ads\.example|tracker\.example/.test(h)), 'block counter must carry the ad fixture host');
});
