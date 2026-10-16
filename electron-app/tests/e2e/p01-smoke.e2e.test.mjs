/**
 * P01 gate — native E2E smoke on the app's own WebView2:
 *  1. the app starts and stops in an isolated test data-root;
 *  2. Playwright reads the React chrome UI and opens a controlled fixture
 *     tab in the SAME BrowserHost (real path: React → Tauri invoke → Rust →
 *     tab webview navigation);
 *  3. a malformed IPC argument produces a verifiable rejection;
 *  4. no orphan processes survive the run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';

test('P01: isolated lifecycle, same-host fixture tab, negative IPC, no orphans', { timeout: 180_000 }, async (t) => {
  const app = new AppHandle();
  t.after(async () => { await app.stop(); });

  await app.launch();

  // 1. Chrome UI is alive and mounted.
  const chromePage = app.chromePage();
  await chromePage.waitForSelector('.commandbar__input', { timeout: 30_000 });

  // 2. Real navigation path through the UI: type fixture URL, Enter.
  const staticUrl = fixtureServer.url('/static');
  await chromePage.fill('.commandbar__input', staticUrl);
  await chromePage.keyboard.press('Enter');

  const tabPage = await app.waitTabPage(/\/static/, 30_000);
  await tabPage.waitForSelector('#fixture-marker', { timeout: 20_000 });
  const marker = await tabPage.textContent('#fixture-marker');
  assert.equal(marker, 'FIXTURE_STATIC_OK', 'fixture page content must be visible in the tab webview');

  // 3. Negative IPC: malformed/unknown args must reject, not crash the app.
  const rejection = await chromePage.evaluate(async () => {
    try {
      // Wrong argument NAME (req missing entirely) — must be an error.
      await window.__TAURI_INTERNALS__.invoke('browser_navigate', { wrong: true });
      return 'resolved-unexpectedly';
    } catch (e) {
      return `rejected:${String(e).slice(0, 200)}`;
    }
  });
  assert.match(rejection, /^rejected:/, `bad IPC args must reject (got: ${rejection})`);
  const stillAlive = await chromePage.evaluate(() => Boolean(document.querySelector('.commandbar__input')));
  assert.ok(stillAlive, 'chrome UI must survive the rejected invoke');

  // Unknown tab id must produce a structured Rust error, not a hang.
  const unknownTab = await chromePage.evaluate(async (url) => {
    try {
      await window.__TAURI_INTERNALS__.invoke('browser_navigate', { req: { tabId: 'no-such-tab', url } });
      return 'resolved-unexpectedly';
    } catch (e) {
      return `rejected:${String(e).slice(0, 200)}`;
    }
  }, staticUrl);
  assert.match(unknownTab, /^rejected:/, `unknown tab must reject (got: ${unknownTab})`);
});
