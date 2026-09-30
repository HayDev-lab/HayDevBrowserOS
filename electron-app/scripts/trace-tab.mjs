// Trace: open httpbin tab, watch tabs+port every second to catch the moment
// the tab disappears.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = 'D:/Projects/BrowserHayDev/electron-app/src-tauri/target/release/app.exe';
function httpJson(port) {
  return new Promise((res) => {
    http.get({ host: '127.0.0.1', port, path: '/json', timeout: 800 }, (r) => {
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

try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {}
await sleep(2000);
spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
const chromePort = await findPort('tauri.localhost', 9220, 9240);
const chrome = await wsConnect((await httpJson(chromePort)).find((x) => x.url.includes('tauri.localhost')).webSocketDebuggerUrl);
const ev = async (expr) => (await chrome.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await sleep(5000);
const opened = await ev(`window.__TAURI_INTERNALS__.invoke('browser_tabs_open', {req:{url:'https://httpbin.org/forms/post'}}).then(v=>'OK:'+v).catch(e=>'ERR:'+JSON.stringify(e))`);
console.log('open:', opened);
const tabId = String(opened).replace('OK:', '');

// 1-second trace of tabs + CDP port health
const dbg = Number(await ev(`window.__TAURI_INTERNALS__.invoke('browser_debug_port')`));
for (let sec = 0; sec < 25; sec++) {
  await sleep(1000);
  const list = await ev(`window.__TAURI_INTERNALS__.invoke('browser_tabs_list').then(v=>JSON.stringify(v.map(t=>t.url.slice(0,30)))).catch(e=>'LISTERR')`);
  const portUp = (await httpJson(dbg)) !== null;
  const proc = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process app -ErrorAction SilentlyContinue | Measure-Object).Count`]).toString().trim();
  console.log(`t=${sec}s tabs=${list} cdp9330=${portUp} appProcs=${proc}`);
  if (!portUp) break;
}
chrome.socket.end();
try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {}
console.log('DONE');
