import test from 'node:test';
import assert from 'node:assert/strict';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const invoke=(page,command,args={})=>page.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[command,args]);

test('P14: validated redirects, broken reads and no network/page effects after revocation',{timeout:60000},async t=>{
  const app=new AppHandle();t.after(()=>app.stop());await app.launch();const chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');
  const tabId=await app.activeTabId(chrome);
  await invoke(chrome,'browser_navigate',{req:{tabId,url:fixtureServer.url('/static')}});
  await app.waitTabPage(/\/static/);
  await invoke(chrome,'control_set_mode',{mode:'AGENT'});
  const obs=fixtureServer.observations;
  for(const [pathname,error] of [['/research-redirect',null],['/redirect-private','permitted public'],['/redirect-loop','TOO_MANY_REDIRECTS'],['/read-broken','FETCH_READ_ERROR']]) {
    const before=obs.toolResults.length;
    const run=await invoke(chrome,'agent_run',{req:{command:`!!fetch ${fixtureServer.url(pathname)}`,profile:'DEEP_RESEARCH',maxSteps:3}});
    assert.equal(run.status,'ok'); assert.equal(obs.toolResults.length,before+1);
    const result=obs.toolResults.at(-1);
    if(error) assert.match(JSON.stringify(result),new RegExp(error));
    else {assert.equal(result.untrustedContent,true);assert.match(result.text,/100 degrees Celsius/);}
  }
  assert.equal(obs.requests.includes('/effect'),false,'private redirect never connected');
  for(const [operation,pathname,revoke] of [['fetch','/slow-redirect','agent_stop'],['navigate','/slow-page','control_take_control']]) {
    await invoke(chrome,'control_set_mode',{mode:'AGENT'});
    const run=invoke(chrome,'agent_run',{req:{command:`!!${operation} ${fixtureServer.url(pathname)}`,profile:'DEEP_RESEARCH',maxSteps:3}});
    const deadline=Date.now()+4000;while(!obs.requests.includes(pathname)&&Date.now()<deadline)await pause(20);
    assert.ok(obs.requests.includes(pathname),'actual request must have started');
    const start=performance.now();await invoke(chrome,revoke,{reason:'synthetic network revocation'});
    const ackMs=performance.now()-start;assert.ok(ackMs<=250,`ack ${ackMs}ms`);await run;
    assert.ok(performance.now()-start<=2000,'controller drained within 2s');
    await invoke(chrome,'control_set_mode',{mode:'AGENT'});
    assert.equal((await invoke(chrome,'agent_run',{req:{command:'next isolated run',maxSteps:1}})).status,'ok');
    await pause(3400);
    assert.equal(obs.requests.includes('/effect'),false,'revoked request cannot follow redirect or commit delayed page script');
    const timeline=await invoke(chrome,'agent_timeline_list');assert.equal(timeline.some(x=>['web_fetch','navigate'].includes(x.kind)),false);
    console.log(JSON.stringify({gate:'network-revocation',operation,revoke,ackMs,effects:0}));
  }
});
