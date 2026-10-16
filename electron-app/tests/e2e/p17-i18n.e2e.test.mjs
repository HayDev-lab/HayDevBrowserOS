import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
const pause = ms => new Promise(r => setTimeout(r, ms));
const invoke = (page, c, a = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [c, a]);
async function until(f, message) { const end = Date.now() + 20000; do { if (await f()) return; await pause(150); } while (Date.now() < end); assert.fail(message); }

// The built newtab/search pages carry the locale in <html lang> and <title>.
const NEWTAB_TITLE = { en: /new tab|search/i, ru: /новая вкладка/i, hy: /նոր ներդնում|նոր էջ/i };

test('P17: locale persists across restart and localizes chrome and internal pages', { timeout: 150000 }, async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'haydev-e2e-i18n-')); let app = new AppHandle();
  t.after(async () => { await app.stop(); rmSync(root, { recursive: true, force: true }); });
  await app.launch({ dataRoot: root });
  let chrome = app.chromePage(); await chrome.waitForSelector('.commandbar__input');
  // 1. Switch to RU and persist across restart.
  const setResult = await invoke(chrome, 'set_locale', { locale: 'ru' });
  assert.equal(setResult.locale, 'ru');
  await app.stop({ graceful: true });
  app = new AppHandle(); await app.launch({ dataRoot: root });
  chrome = app.chromePage(); await chrome.waitForSelector('.commandbar__input');
  assert.equal(await invoke(chrome, 'ui_locale'), 'ru', 'locale must persist across restart');
  // The shell adopts the host locale asynchronously on boot.
  await until(async () => (await chrome.evaluate(() => document.documentElement.lang)) === 'ru',
    'chrome document must adopt the persisted ru locale');

  // 2. RU newtab page served after restart (lang attribute + localized title).
  const newtabPage = app.tabPages().find(p => /pab\.newtab|pab:\/\/newtab|pab\.localhost\/newtab/i.test(p.url()));
  assert.ok(newtabPage, 'newtab internal page must exist');
  await until(async () => (await newtabPage.evaluate(() => document.documentElement.lang)) === 'ru',
    'restored newtab must be served in ru');
  assert.match(await newtabPage.evaluate(() => document.title), NEWTAB_TITLE.ru, 'ru newtab title');

  // 3. RU shell labels.
  const shellText = await chrome.evaluate(() => document.body.innerText);
  assert.match(shellText, /истор/i, 'shell must show the RU history label');
  assert.match(shellText, /загрузк/i, 'shell must show the RU downloads label');

  // 4. Live switch to HY and EN: the next page load picks up the new locale
  // (internal pages are rendered at load time, not patched in place).
  await invoke(chrome, 'set_locale', { locale: 'hy' });
  await newtabPage.reload();
  await until(async () => (await newtabPage.evaluate(() => document.documentElement.lang)) === 'hy',
    'reloaded newtab must render in HY');
  await invoke(chrome, 'set_locale', { locale: 'en' });
  await newtabPage.reload();
  await until(async () => (await newtabPage.evaluate(() => document.documentElement.lang)) === 'en',
    'reloaded newtab must render in EN');
  assert.equal(await invoke(chrome, 'ui_locale'), 'en');
});
