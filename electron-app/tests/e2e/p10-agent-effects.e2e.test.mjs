import test from 'node:test';
import assert from 'node:assert/strict';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('P10: queued renderer actions cannot survive STOP/takeover or contaminate a new run',{timeout:90000},async t=>{
  const app=new AppHandle();t.after(()=>app.stop());await app.launch();const chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');
  const invoke=(c,a={})=>chrome.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);
  const id=await app.activeTabId(chrome);await invoke('browser_navigate',{req:{tabId:id,url:fixtureServer.url('/effects')}});
  const page=await app.waitTabPage(/\/effects/);await page.waitForSelector('#effect-button');
  console.log(await page.evaluate(()=>{try{return {predicate:typeof window.__haydevRunAllowed, invalid:window.__haydevRunAllowed(123)}}catch(e){return {hostError:String(e)}}}));
  for(const revoke of ['agent_stop','control_take_control']) {
    await invoke('control_set_mode',{mode:'AGENT'});
    const run=invoke('agent_run',{req:{command:'!!busyclick click the fixture button',maxSteps:2}});
    const busy=page.evaluate(()=>{const end=performance.now()+2500;while(performance.now()<end){};}).catch(()=>{});
    const deadline=Date.now()+5000;let dispatched=false;
    while(Date.now()<deadline) { const timeline=await invoke('agent_timeline_list'); if(timeline.some(x=>x.kind==='click')){dispatched=true;break;} await pause(30); }
    assert.equal(dispatched,true);
    const start=performance.now();assert.equal((await invoke(revoke,{reason:'synthetic revoke'})).accepted,true);
    const ack=performance.now()-start;assert.ok(ack<=250,`${revoke} acknowledgement ${ack}ms`);
    await run;assert.ok(performance.now()-start<=2000,'controller drain <= 2 seconds');
    await invoke('control_set_mode',{mode:'AGENT'});
    const next=await invoke('agent_run',{req:{command:'new run',maxSteps:1}});assert.equal(next.status,'ok');
    await busy;
    const effects=await (await fetch(fixtureServer.url('/effect-count'))).json();assert.equal(effects.count,0,'no click request after revocation');
    const timeline=await invoke('agent_timeline_list');assert.equal(timeline.some(x=>x.kind==='click'),false,'new run state remains its own');
    console.log(JSON.stringify({gate:'renderer-revocation',revoke,ackMs:ack,actualClickRequests:effects.count}));
  }
  const typed=await invoke('agent_run',{req:{command:'!!sensitive type the fixture text',maxSteps:3}});assert.equal(typed.status,'ok');
  assert.equal(await page.inputValue('#effect-input'),'synthetic-sensitive-29b7');
  assert.equal(JSON.stringify(await invoke('agent_timeline_list')).includes('synthetic-sensitive-29b7'),false);
});
