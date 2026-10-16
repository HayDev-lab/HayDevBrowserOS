import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';
const pause = ms => new Promise(r => setTimeout(r, ms));
const invoke = (page, c, a = {}) => page.evaluate(([c,a]) => window.__TAURI_INTERNALS__.invoke(c,a), [c,a]);
async function until(f, message) { const end = Date.now()+10000; do { if(await f()) return; await pause(100); } while(Date.now()<end); assert.fail(message); }

test('P11: crash restores committed tabs, excludes private tabs, preserves a corrupt original', {timeout:90000}, async t => {
  const root=mkdtempSync(path.join(tmpdir(),'haydev-e2e-session-')); let app=new AppHandle();
  t.after(async()=>{await app.stop();rmSync(root,{recursive:true,force:true});});
  writeFileSync(path.join(root,'privacy.json'),JSON.stringify({privateEgress:'direct'}));
  await app.launch({dataRoot:root});let chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');
  const opened=await invoke(chrome,'browser_tabs_open',{req:{url:fixtureServer.url('/static?crash=1'),activate:true}});
  assert.ok(opened.tabId || opened.id || typeof opened === 'string');
  await app.waitTabPage(/crash=1/);
  await invoke(chrome,'browser_tabs_open',{req:{url:fixtureServer.url('/static?private=1'),incognito:true,activate:false}});
  await until(()=>{try{return JSON.parse(readFileSync(path.join(root,'session.json'))).tabs.some(t=>t.url.includes('crash=1'));}catch{return false;}},'committed tab must be saved before exit');
  await app.stop({graceful:false});app=new AppHandle();await app.launch({dataRoot:root});chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');
  await until(async()=> (await invoke(chrome,'browser_tabs_list')).some(t=>t.url.includes('crash=1')),'crash session did not restore');
  assert.ok((await invoke(chrome,'browser_tabs_list')).every(t=>!t.isIncognito && !t.url.includes('private=1')));
  await app.stop();
  const corrupt='{"version":1,"tabs": BROKEN';writeFileSync(path.join(root,'session.json'),corrupt);
  app=new AppHandle();await app.launch({dataRoot:root});chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');
  await until(async()=>await chrome.locator('[role="alert"]').count()>0,'storage corruption must be visible in UI');
  assert.equal(readFileSync(path.join(root,'session.json'),'utf8'),corrupt,'corrupt original must remain recoverable');
});

test('P11: strict agent routing cannot use an ordinary direct tab', {timeout:60000}, async t => {
  const root=mkdtempSync(path.join(tmpdir(),'haydev-e2e-strict-')); const app=new AppHandle();
  t.after(async()=>{await app.stop();rmSync(root,{recursive:true,force:true});});
  writeFileSync(path.join(root,'privacy.json'),JSON.stringify({agentEgress:'tor-strict',privateEgress:'direct'}));
  await app.launch({dataRoot:root});const chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');
  const before=await invoke(chrome,'browser_tabs_list');
  await invoke(chrome,'control_set_mode',{mode:'AGENT'});
  const result=await invoke(chrome,'agent_run',{req:{command:'!!busyclick click',maxSteps:1}});
  assert.equal(result.status,'error');
  assert.match(JSON.stringify(result),/TOR_UNAVAILABLE|EGRESS_UNAVAILABLE/);
  const after=await invoke(chrome,'browser_tabs_list');
  assert.equal(after.length,before.length,'failed routed WebView leaves no successful phantom tab');
  assert.ok(after.every(t=>t.profile!=='agent' && t.egress==='direct'));
});

test('P11: profile creation I/O failure reaches IPC and removes the pending tab', {timeout:60000}, async t => {
  const root=mkdtempSync(path.join(tmpdir(),'haydev-e2e-create-'));const app=new AppHandle();
  t.after(async()=>{await app.stop();rmSync(root,{recursive:true,force:true});});
  mkdirSync(path.join(root,'profiles'));writeFileSync(path.join(root,'profiles/agent'),'synthetic blocked directory');
  await app.launch({dataRoot:root});const chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');
  const count=(await invoke(chrome,'browser_tabs_list')).length;
  await assert.rejects(invoke(chrome,'browser_tabs_open',{req:{url:fixtureServer.url('/static'),agent:true,activate:true}}));
  assert.equal((await invoke(chrome,'browser_tabs_list')).length,count);
});
