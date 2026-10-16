import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';
const pause = ms => new Promise(r => setTimeout(r,ms));
const invoke = (page,c,a={}) => page.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);
const evaluate = (page,id,expression) => invoke(page,'browser_evaluate',{req:{tabId:id,expression}});
async function ready(page,id) {
  const end=Date.now()+15000;
  while(Date.now()<end) { try { if(await evaluate(page,id,'document.readyState === "complete" && !!document.body && !!document.getElementById("fixture-marker")')) return; } catch {} await pause(100); }
  assert.fail(`Fixture not loaded in ${id}`);
}
async function open(page,url,extra={}) {
  const id=randomUUID();await invoke(page,'browser_tabs_open',{req:{id,url,activate:true,...extra}});return id;
}

test('P12: identical URLs retain separate DOM and native screenshot targets',{timeout:60000},async t=>{
  const app=new AppHandle();t.after(()=>app.stop());await app.launch();const chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');
  const a=await open(chrome,fixtureServer.url('/static'));await ready(chrome,a);
  const b=await open(chrome,fixtureServer.url('/static'));await ready(chrome,b);
  for (const [id,color] of [[a,'red'],[b,'blue']]) {
    await evaluate(chrome,id,`(() => { document.documentElement.style.background='${color}';document.body.innerHTML='';document.body.style.cssText='margin:0;background:${color};height:100vh';return true;})()`);
  }
  for (const [id,color,index] of [[a,'red',0],[b,'blue',2]]) {
    await invoke(chrome,'browser_tabs_activate',{req:{tabId:id}});await pause(150);
    const shot=await invoke(chrome,'browser_screenshot',{req:{tabId:id}});
    const png=PNG.sync.read(readFileSync(shot.path));let colored=0;
    for(let p=0;p<png.data.length;p+=4)if(png.data[p+index]>240 && png.data[p+(index===0?2:0)]<10)colored++;
    assert.ok(colored/(png.width*png.height)>.95,`Wrong concrete screenshot target for ${color}`);
  }
  const tabs=await invoke(chrome,'browser_tabs_list');assert.equal(tabs.find(t=>t.id===a).url,tabs.find(t=>t.id===b).url);
});

async function socksFixture() {
  const sockets=new Set(), requests=[];
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    let stage=0,buffer=Buffer.alloc(0);
    const read=chunk=>{ buffer=Buffer.concat([buffer,chunk]);
      if(stage===0){if(buffer.length<2||buffer.length<2+buffer[1])return;buffer=buffer.subarray(2+buffer[1]);socket.write(Buffer.from([5,0]));stage=1;}
      if(stage===1){if(buffer.length<5)return;const type=buffer[3];const n=type===3?buffer[4]:type===1?4:type===4?16:0;const offset=type===3?5:4;if(!n||buffer.length<offset+n+2)return;
        const host=type===3?buffer.subarray(offset,offset+n).toString():type===1?[...buffer.subarray(offset,offset+n)].join('.'):'ipv6';const port=buffer.readUInt16BE(offset+n);requests.push({host,port});
        if(!['route.test','127.0.0.1'].includes(host)||port!==fixtureServer.port){socket.end(Buffer.from([5,2,0,1,127,0,0,1,0,0]));return;}
        const rest=buffer.subarray(offset+n+2);stage=2;socket.removeListener('data',read);
        const upstream=net.connect(fixtureServer.port,'127.0.0.1',()=>{socket.write(Buffer.from([5,0,0,1,127,0,0,1,0,0]));if(rest.length)upstream.write(rest);socket.pipe(upstream);upstream.pipe(socket);});
        sockets.add(upstream);upstream.on('close',()=>sockets.delete(upstream));upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());
      }
    };socket.on('data',read);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {port:server.address().port,requests,async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}

test('P12: agent/private profiles use actual SOCKS route, isolate storage, and keep Shield',{timeout:90000},async t=>{
  const proxy=await socksFixture();const root=mkdtempSync(path.join(tmpdir(),'haydev-e2e-route-'));const app=new AppHandle();
  t.after(async()=>{await app.stop();await proxy.close();rmSync(root,{recursive:true,force:true});});
  const route={socks5:{host:'127.0.0.1',port:proxy.port}};
  writeFileSync(path.join(root,'privacy.json'),JSON.stringify({agentEgress:route,privateEgress:route}));
  await app.launch({dataRoot:root});const chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');
  const normal=await open(chrome,fixtureServer.url('/static'));await ready(chrome,normal);
  await evaluate(chrome,normal,"(localStorage.setItem('profile-proof','default'),document.cookie='profile-proof=default',true)");
  for(const extra of [{agent:true},{incognito:true}]) {
    const id=await open(chrome,`http://route.test:${fixtureServer.port}/static`,extra);await ready(chrome,id);
    const tab=(await invoke(chrome,'browser_tabs_list')).find(t=>t.id===id);assert.equal(tab.egress,`socks5://127.0.0.1:${proxy.port}`);assert.equal(tab.profile,extra.agent?'agent':'private');
    assert.equal(await evaluate(chrome,id,"localStorage.getItem('profile-proof')"),null);
    await evaluate(chrome,id,`(localStorage.setItem('profile-proof','${tab.profile}'),true)`);
    const before=(await invoke(chrome,'shield_status')).totalBlocked;
    await evaluate(chrome,id,"(fetch('http://tracker.example/native-profile').catch(()=>{}),true)");
    const end=Date.now()+5000;while((await invoke(chrome,'shield_status')).totalBlocked===before && Date.now()<end)await pause(50);
    assert.ok((await invoke(chrome,'shield_status')).totalBlocked>before,'Shield must protect routed profile');
    // Same origin as the default tab, in a different profile, must also isolate cookies/storage.
    await invoke(chrome,'browser_navigate',{req:{tabId:id,url:fixtureServer.url('/static')}});await ready(chrome,id);
    assert.equal(await evaluate(chrome,id,"localStorage.getItem('profile-proof')"),null);
    assert.equal(await evaluate(chrome,id,"document.cookie.includes('profile-proof=default')"),false);
  }
  assert.ok(proxy.requests.filter(r=>r.host==='route.test').length>=2,'both profiles must reach the SOCKS fixture');
  assert.ok(proxy.requests.filter(r=>r.host==='127.0.0.1').length>=2,'proxied profiles must not silently bypass the proxy for loopback');
  assert.equal(await evaluate(chrome,normal,"localStorage.getItem('profile-proof')"),'default');
  console.log(JSON.stringify({gate:'profile-egress',routedRequests:proxy.requests.filter(r=>r.host==='route.test').length,profiles:['agent','private'],storageIsolation:true}));
});
