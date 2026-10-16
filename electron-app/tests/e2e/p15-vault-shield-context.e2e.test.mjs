import test from 'node:test';
import assert from 'node:assert/strict';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';
const invoke=(p,c,a={})=>p.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);

test('P15: vault document identity and Shield login/OAuth/WebSocket/video compatibility',{timeout:60000},async t=>{
  const app=new AppHandle();t.after(()=>app.stop());await app.launch();const chrome=app.chromePage();await chrome.waitForSelector('.commandbar__input');
  const tabId=await app.activeTabId(chrome);
  const navigate=async (pathname,pattern=pathname.split('?')[0])=>{await invoke(chrome,'browser_navigate',{req:{tabId,url:fixtureServer.url(pathname)}});return app.waitTabPage(new RegExp(pattern));};
  let page=await navigate('/login');await page.waitForSelector('#fixture-login');
  const firstId=await page.evaluate(()=>window.__haydevDocumentId);assert.match(firstId,/^[0-9a-f]{32}$/);
  assert.equal(await page.evaluate(()=>Reflect.defineProperty(window,'__haydevDocumentId',{value:'page-controlled'})),false);
  const saved=await invoke(chrome,'vault_save',{input:{domain:'127.0.0.1',username:'synthetic-user',password:'synthetic-context-secret'}});
  // Change the URL after the native capture, during field discovery and before
  // the first write. The guard must reject the fill without populating fields.
  await page.evaluate(()=>{const query=document.querySelector.bind(document);let changed=false;document.querySelector=(s)=>{if(!changed){changed=true;history.replaceState(null,'','/login?document-changed');}return query(s);};});
  const refused=await chrome.evaluate(async input=>{try {await window.__TAURI_INTERNALS__.invoke('vault_fill',{input});return {accepted:true};}catch(error){return {error};}},{id:saved.record.id,tabId});
  assert.match(JSON.stringify(refused),/VAULT_DOCUMENT_CHANGED/);
  assert.equal(await page.inputValue('#fixture-pass'),'');assert.equal(await page.inputValue('#fixture-user'),'');
  await page.reload();await page.waitForSelector('#fixture-login');
  assert.notEqual(await page.evaluate(()=>window.__haydevDocumentId),firstId,'reload gets a fresh immutable document identity');
  assert.equal((await invoke(chrome,'vault_fill',{input:{id:saved.record.id,tabId}})).success,true);
  await page.click('#fixture-login-btn');await page.waitForSelector('#fixture-who');assert.equal(await page.textContent('#fixture-who'),'synthetic-user');
  page=await navigate('/oauth/start','/oauth/callback');await page.waitForSelector('#oauth-result');assert.equal(await page.textContent('#oauth-result'),'OAUTH_OK');
  page=await navigate('/ws');await page.waitForFunction(()=>document.querySelector('#ws-status')?.textContent==='echo:echo:ping-from-fixture');
  const media=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d');const stream=canvas.captureStream(15);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(r=>recorder.onstop=r);recorder.start();
    for(let i=0;i<8;i++){ctx.fillStyle=i%2?'red':'blue';ctx.fillRect(0,0,64,64);await new Promise(r=>setTimeout(r,70));}
    recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());
    return btoa(String.fromCharCode(...new Uint8Array(await new Blob(chunks).arrayBuffer())));
  });
  fixtureServer.observations.video=Buffer.from(media,'base64');assert.ok(fixtureServer.observations.video.length>100);
  await page.evaluate(async()=>{const v=document.createElement('video');v.id='network-video';v.muted=true;v.src='/video.webm';document.body.append(v);await v.play();});
  await page.waitForFunction(()=>document.querySelector('#network-video').currentTime>0.1);
  assert.ok(fixtureServer.observations.requests.includes('/video.webm'));
  assert.equal((await invoke(chrome,'shield_status')).enabled,true);
  console.log(JSON.stringify({gate:'vault-shield-context',documentGuard:true,login:true,oauthFixture:true,websocket:true,networkVideoBytes:fixtureServer.observations.video.length}));
});
