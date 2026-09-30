// PHASE D E2E — BrowserAutomationBridge (string-based asserts).
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = 'D:/Projects/BrowserHayDev/electron-app/src-tauri/target/release/app.exe';
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
    const send = (method, params = {}, tmo = 40000) => new Promise((res2) => {
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

try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {}
await sleep(2000);
spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
const chromePort = await findPort('tauri.localhost', 9220, 9240);
const chrome = await wsConnect((await httpJson(chromePort)).find((x) => x.url.includes('tauri.localhost')).webSocketDebuggerUrl);
// inv always returns a STRING: 'OK:<json>' or 'ERR:<json>'
const inv = async (cmd, args) => {
  const r = await chrome.send('Runtime.evaluate', {
    expression: `window.__TAURI_INTERNALS__.invoke('${cmd}', ${JSON.stringify(args ?? {})}).then(v=>'OK:'+JSON.stringify(v)).catch(e=>'ERR:'+JSON.stringify(e))`,
    awaitPromise: true, returnByValue: true,
  });
  const v = r.result?.result?.value;
  return typeof v === 'string' ? v : 'NOSTRING:' + JSON.stringify(v);
};
const invOk = async (cmd, args) => (await inv(cmd, args)).startsWith('OK:');

await sleep(6000);
const tabOpen = await inv('browser_tabs_open', { req: { url: 'https://httpbin.org/forms/post' } });
pass('bridge target opened', tabOpen.startsWith('OK:'), tabOpen.slice(0, 40));
const tabId = tabOpen.replace('OK:', '"').slice(0, 40).match(/[0-9a-f-]{36}/)?.[0] ?? tabOpen;
await sleep(9000);

const tabsAt = async () => await inv('browser_tabs_list');
const ev1 = await inv('browser_evaluate', { req: { tabId, expression: `document.querySelectorAll('form input').length` } });
pass('evaluate: input count', /OK:\s*"?1[01]"?/.test(ev1), ev1.slice(0, 80));

const snap = await inv('browser_dom_snapshot', { req: { tabId }, max: 50 });
pass('dom_snapshot: nodes returned', /"nodes":\s*\[\s*{/.test(snap), `len=${snap.length}`);

const typed = await inv('browser_type_text', { req: { tabId, selector: 'input[name="custname"]', text: 'HayDev Bridge', clear: true } });
pass('type: value set', typed.includes('HayDev Bridge'), typed.slice(0, 110));

const key = await inv('browser_press_key', { req: { tabId, key: 'Tab' } });
pass('press_key dispatched', key.includes('"dispatched":true'), key.slice(0, 110));

const sc = await inv('browser_scroll_by', { req: { tabId, dx: 0, dy: 300 } });
pass('scroll', /"scrollY":/.test(sc), sc.slice(0, 110));

const opt = await inv('browser_click', { req: { tabId, selector: 'input[value="medium"]' } });
pass('click: radio', opt.includes('"clicked":"input"'), opt.slice(0, 110));
const btn = await inv('browser_click', { req: { tabId, selector: 'form button' } });
pass('click: form submit button', btn.includes('"clicked":"button"'), btn.slice(0, 110));
await sleep(6000);
const list = await inv('browser_tabs_list');
console.log('tabs after click:', (await tabsAt()));
pass('submit navigated (POST result in registry)', /httpbin\.org\/post(?!\/forms)/.test(list), list.slice(0, 200));

const shotLong = async (cmd, args) => {
  const r = await chrome.send('Runtime.evaluate', {
    expression: `window.__TAURI_INTERNALS__.invoke('${cmd}', ${JSON.stringify(args)}).then(v=>'OK:'+JSON.stringify(v)).catch(e=>'ERR:'+JSON.stringify(e))`,
    awaitPromise: true, returnByValue: true,
  });
  const v = r.result?.result?.value;
  return typeof v === 'string' ? v : 'NOSTRING:' + JSON.stringify(v);
};
const shot = await shotLong('browser_screenshot', { req: { tabId } });
let shotOk = false;
const m = shot.match(/"path":"([^"]+)"/);
if (m && fs.existsSync(m[1].replace(/\\\\/g, '\\'))) {
  shotOk = fs.statSync(m[1].replace(/\\\\/g, '\\')).size > 1000;
}
pass('screenshot: real PNG on disk', shotOk, shot.slice(0, 130));

chrome.socket.end();
try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} PASS`);
