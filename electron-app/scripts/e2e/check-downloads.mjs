import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fixtureServer } from './fixtures/server.mjs';
const pause = ms => new Promise(r => setTimeout(r, ms));
export async function checkDownloads(app, chrome) {
  const invoke = (c,a={}) => chrome.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);
  const tabId = await invoke('browser_tabs_open',{req:{url:fixtureServer.url('/static'),activate:true}});
  const page = await app.waitTabPage(/\/static/);
  const begin = async (suffix) => {
    await page.evaluate(url => { const a=document.createElement('a'); a.href=url; a.textContent='Download'; a.id='test-download'; document.body.append(a); },fixtureServer.url(suffix));
    await page.locator('#test-download').last().click();
  };
  const wait = async (predicate) => {
    const deadline=Date.now()+30000;
    while(Date.now()<deadline) { const items=await invoke('browser_downloads_list'); const match=items.find(predicate); if(match) return match; await pause(50); }
    assert.fail('Native download did not reach the expected state');
  };
  await begin('/download');
  const first=await wait(x=>x.state==='completed');
  assert.equal(first.tabId,tabId); assert.equal(first.receivedBytes,2*1024*1024); assert.equal(first.totalBytes,first.receivedBytes);
  assert.equal(statSync(first.savePath).size,first.receivedBytes);
  const expected=createHash('sha256').update(Buffer.alloc(2*1024*1024,0x41)).digest('hex');
  assert.equal(createHash('sha256').update(readFileSync(first.savePath)).digest('hex'),expected);
  await begin('/download');
  const second=await wait(x=>x.id!==first.id && x.state==='completed');
  assert.notEqual(second.savePath,first.savePath);
  assert.equal(statSync(first.savePath).size,2*1024*1024);
  await begin('/download-slow');
  const slow=await wait(x=>x.url.endsWith('/download-slow') && x.state==='downloading' && x.receivedBytes>0);
  assert.ok(slow.receivedBytes<slow.totalBytes);
  assert.equal(await invoke('browser_downloads_cancel',{id:slow.id}),true);
  await wait(x=>x.id===slow.id && x.state==='cancelled');
  await begin('/download-broken');
  await wait(x=>x.url.endsWith('/download-broken') && x.state==='failed');
  console.log(JSON.stringify({gate:'downloads',sha256:expected,bytes:first.receivedBytes,progress:true,cancel:true,collision:true,failure:true}));
}
