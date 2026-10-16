import { AppHandle } from './harness.mjs';
import { fixtureServer } from './fixtures/server.mjs';
import { readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const app = new AppHandle();
try {
  await app.launch(); const chrome = app.chromePage();
  await chrome.waitForSelector('.commandbar__input');
  const invoke = (c,a) => chrome.evaluate(([c,a]) => window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);
  const id = await app.activeTabId(chrome);
  await invoke('browser_navigate',{req:{tabId:id,url:fixtureServer.url('/static')}});
  const page = await app.waitTabPage(/\/static/);
  const client = await app.tabs.newBrowserCDPSession();
  client.on('Browser.downloadWillBegin', e=>console.log('begin',JSON.stringify(e)));
  client.on('Browser.downloadProgress', e=>console.log('progress',JSON.stringify(e)));
  const destination = path.join(app.dataRoot,'downloads'); mkdirSync(destination,{recursive:true});
  console.log('setBehavior',await client.send('Browser.setDownloadBehavior',{behavior:'default',eventsEnabled:true}));
  await page.click('#fixture-dl-link');
  await new Promise(r=>setTimeout(r,5000));
  console.log('registry',JSON.stringify(await invoke('browser_downloads_list',{})));
  console.log('files',JSON.stringify(readdirSync(destination)));
} finally { await app.stop({runDir:path.resolve('../artifacts/closure/20261015-stabilization-r08')}); }
