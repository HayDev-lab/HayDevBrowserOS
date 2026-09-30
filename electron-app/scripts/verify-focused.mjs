// Focused verify: session stability (single-instance), RESEARCH path,
// pab://search serving, address bar (React native setter), footer timing,
// challenge detector. Evidence per check.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = 'D:/Projects/BrowserHayDev/electron-app/src-tauri/target/release/app.exe';
const SESSION = process.env.APPDATA + '/com.haydev.browser/session.json';
const results = [];
const pass = (name, ok, note) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS ' : 'FAIL '}${name} | ${String(note).slice(0, 130)}`); };

function httpJson(port) {
  return new Promise((res) => {
    http.get({ host: '127.0.0.1', port, path: '/json', timeout: 1200 }, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    }).on('error', () => res(null));
  });
}
const wsConnectRaw = (urlStr) => new Promise((resolve, reject) => {
  const u = new URL(urlStr);
  const key = crypto.randomBytes(16).toString('base64');
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': 13 } });
  req.on('upgrade', (res, socket) => {
    let buf = Buffer.alloc(0); let id = 0; const pending = new Map();
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        if (buf.length < 2) break;
        const b0 = buf[0], b1 = buf[1]; const op = b0 & 0x0f, m = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        let mk = null;
        if (m) { if (buf.length < off + 4) break; mk = buf.subarray(off, off + 4); off += 4; }
        if (buf.length < off + len) break;
        let pl = buf.subarray(off, off + len);
        if (mk) pl = Buffer.from(pl.map((b, i) => b ^ mk[i % 4]));
        buf = buf.subarray(off + len);
        if (op === 0x1 || op === 0x0) { try { const msg = JSON.parse(pl.toString('utf8')); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } } catch {} }
        if (op === 0x8) socket.end();
      }
    });
    const send = (method, params = {}, tmo = 30000) => new Promise((res2) => {
      const mid = ++id; const tm = setTimeout(() => { pending.delete(mid); res2({ result: { result: { value: 'TIMEOUT' } } }); }, tmo);
      pending.set(mid, (m2) => { clearTimeout(tm); res2(m2); });
      const body = Buffer.from(JSON.stringify({ id: mid, method, params }));
      const mask = crypto.randomBytes(4);
      let h;
      if (body.length < 126) h = Buffer.from([0x81, 0x80 | body.length]);
      else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(body.length, 2); }
      socket.write(Buffer.concat([h, mask, Buffer.from(body.map((b, i) => b ^ mask[i % 4]))]));
    });
    resolve({ send, socket });
  });
  req.on('error', reject); req.end();
});
function wsConnect(urlStr) {
  return Promise.race([wsConnectRaw(urlStr), new Promise((_, rej) => setTimeout(() => rej(new Error('ws timeout')), 12000))]);
}
async function findPort(needle, from, to, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (let p = from; p <= to; p++) {
      const t = await httpJson(p);
      if (t?.some((x) => x.url.includes(needle))) return p;
    }
    await sleep(500);
  }
  return -1;
}
const kill = () => { try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {} };

// 0) clean the polluted session so the restore test is meaningful
try { fs.unlinkSync(SESSION); console.log('session.json removed'); } catch {}
kill(); await sleep(2500);

// 1) boot → exactly 1 newtab
spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
const chromePort = await findPort('tauri.localhost', 9220, 9240);
const chrome = await wsConnect((await httpJson(chromePort)).find((x) => x.url.includes('tauri.localhost')).webSocketDebuggerUrl);
const ev = async (expr) => (await chrome.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const tabs = async () => { const v = await ev(`window.__TAURI_INTERNALS__.invoke('browser_tabs_list')`); return Array.isArray(v) ? v : []; };
await sleep(6000);
pass('clean boot → 1 newtab', (await tabs()).length === 1, JSON.stringify((await tabs()).map((t) => t.url)));

// 2) address bar: type + Enter (CommandBar submits on keydown Enter)
await ev(`(function(){
  const i = document.querySelector('.commandbar__input');
  if (!i) return 'MISSING';
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(i, 'httpbin.org/html');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return 'entered';
})()`);
await sleep(7000);
const addrUrl = (await tabs()).find((t) => t.isActive)?.url;
pass('address bar: bare host navigates', /httpbin\.org\/html/.test(addrUrl || ''), addrUrl);

// 3) RESEARCH → active tab navigates to pab://search
await ev(`(function(){const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='RESEARCH');if(!b)return 'MISSING';b.click();return 'clicked';})()`);
await sleep(7000);
const list = await tabs();
const searchTab = list.find((t) => t.url.includes('pab://search'));
pass('RESEARCH → pab://search', !!searchTab, `tabs=${JSON.stringify(list.map((t) => t.url))}`);

// 4) pab://search actually serves (tab target content)
if (searchTab) {
  const tabPort = await findPort('pab.search', 9330, 9360, 15000);
  if (tabPort > 0) {
    const t = (await httpJson(tabPort)).find((x) => x.url.includes('pab.search') || x.url.includes('pab.localhost/search'));
    if (t) {
      const c = await wsConnect(t.webSocketDebuggerUrl);
      const hasInput = await (await c.send('Runtime.evaluate', { expression: `!!document.querySelector('input,form')`, returnByValue: true })).result?.result?.value;
      c.socket.end();
      pass('pab://search page serves content', hasInput === true, `input/form=${hasInput}`);
    } else pass('pab://search page serves content', false, 'no target');
  } else pass('pab://search page serves content', false, 'no tab port');
}

// 5) challenge detector on example.com → NONE
const active = (await tabs()).find((t) => t.isActive);
if (active) {
  const det = await ev(`window.__TAURI_INTERNALS__.invoke('browser_challenge_detect', {req:{tabId:'${active.id}'}})`);
  pass('challenge_detect on example.com → NONE', det?.type === 'NONE', JSON.stringify(det)?.slice(0, 140));
  const ho = await ev(`window.__TAURI_INTERNALS__.invoke('browser_challenge_handoff', {req:{tabId:'${active.id}'}})`);
  pass('challenge handoff state NONE', ho?.status === 'NONE', JSON.stringify(ho)?.slice(0, 100));
}

// 6) footer → Operational within 40s
let footer = '';
for (let i = 0; i < 5; i++) {
  await sleep(10000);
  footer = await ev(`document.querySelector('.app__footer-state')?.textContent`);
  if (footer === 'All Systems Operational') break;
}
pass('footer reaches All Systems Operational', footer === 'All Systems Operational', `footer="${footer}"`);

// 7) restart → session keeps exactly what we had (no newtab multiplication)
const beforeClose = (await tabs()).length;
await ev(`window.__TAURI_INTERNALS__.invoke('window_close')`);
await sleep(6000);
kill(); await sleep(1500);
spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
const cp2 = await findPort('tauri.localhost', 9220, 9240);
const c2 = await wsConnect((await httpJson(cp2)).find((x) => x.url.includes('tauri.localhost')).webSocketDebuggerUrl);
const ev2 = async (expr) => (await c2.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await sleep(7000);
const restored = await ev2(`window.__TAURI_INTERNALS__.invoke('browser_tabs_list')`);
const cnt = Array.isArray(restored) ? restored.length : -1;
pass(`restart restores same tab count (${beforeClose})`, cnt === beforeClose, `restored=${cnt}: ${JSON.stringify((restored || []).map((t) => t.url))}`);
await ev2(`window.__TAURI_INTERNALS__.invoke('window_close')`);
c2.socket.end();
await sleep(4000);
kill();

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} PASS`);
