import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';

test('P23: FP toggle affects new private WebView2 tabs and native panel layout resizes content', {timeout:180_000}, async t => {
  const app = new AppHandle();
  t.after(() => app.stop());
  await app.launch();
  const page = app.chromePage();
  await page.waitForSelector('.commandbar__input');
  const invoke = (command,args={}) => page.evaluate(([c,a]) => window.__TAURI_INTERNALS__.invoke(c,a),[command,args]);
  const evaluate = (tabId,expression) => invoke('browser_evaluate',{req:{tabId,expression}});
  const normal = await app.activeTabId(page);
  await invoke('browser_navigate',{req:{tabId:normal,url:fixtureServer.url('/static')}});
  await app.waitTabPage(/\/static/);
  const openPrivate = async () => {
    const id = randomUUID();
    await invoke('browser_tabs_open',{req:{id,url:fixtureServer.url('/static'),incognito:true,activate:true}});
    await page.waitForFunction(async tabId => {
      try { return await window.__TAURI_INTERNALS__.invoke('browser_evaluate',{req:{tabId,expression:"document.readyState==='complete' && !!document.getElementById('fixture-marker')"}}); }
      catch { return false; }
    },id);
    return id;
  };
  const first = await openPrivate();
  assert.equal(await evaluate(first,'window.__hdPrivacyNoise === true'),true);
  await page.getByTestId('fingerprint-pill').click();
  await page.waitForFunction(async () => !(await window.__TAURI_INTERNALS__.invoke('privacy_status')).fingerprintNoise);
  assert.equal(JSON.parse(readFileSync(path.join(app.dataRoot,'privacy.json'),'utf8')).fingerprintNoise,false);
  const off = await openPrivate();
  assert.equal(await evaluate(off,'window.__hdPrivacyNoise === true'),false);
  assert.equal(await evaluate(first,'window.__hdPrivacyNoise === true'),true);
  await page.getByTestId('fingerprint-pill').click();
  await page.waitForFunction(async () => (await window.__TAURI_INTERNALS__.invoke('privacy_status')).fingerprintNoise);
  const on = await openPrivate();
  assert.equal(await evaluate(on,'window.__hdPrivacyNoise === true'),true);
  assert.equal(await evaluate(normal,'window.__hdPrivacyNoise === true'),false);
  await invoke('browser_tabs_activate',{req:{tabId:normal}});
  await invoke('window_set_agent_panel_open',{open:true});
  const initial = await evaluate(normal,'window.innerWidth');
  await invoke('window_set_agent_panel_open',{open:false});
  await page.waitForFunction(async ({tabId,width}) => (await window.__TAURI_INTERNALS__.invoke('browser_evaluate',{req:{tabId,expression:'window.innerWidth'}}))>width+100,{tabId:normal,width:initial});
  await invoke('window_set_agent_panel_open',{open:true});
  await page.waitForFunction(async ({tabId,width}) => (await window.__TAURI_INTERNALS__.invoke('browser_evaluate',{req:{tabId,expression:'window.innerWidth'}}))===width,{tabId:normal,width:initial});
  await page.screenshot({path:app.evidenceDir+'/privacy-layout.png'});
});
