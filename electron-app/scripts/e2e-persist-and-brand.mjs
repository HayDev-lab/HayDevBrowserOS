// Combined E2E: persistent profile sessions across restart + brand/logo verification.
// Launches the PACKAGED exe without env vars (dynamic debug ports read from the log).
import { spawn, execFile } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = 'D:/Projects/BrowserHayDev/electron-app/src-tauri/target/release/app.exe';
const LOG = 'D:/tmp-tauri-e2e.log';
const out = [];

function ps(expr) {
  return new Promise((res) => execFile('powershell', ['-NoProfile', '-Command', expr], { maxBuffer: 16 * 1024 * 1024 }, (e, o) => res(e ? '' : o.trim())));
}
function httpJson(port) {
  return new Promise((res) => {
    http.get({ host: '127.0.0.1', port, path: '/json', timeout: 1500 }, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    }).on('error', () => res(null));
  });
}
function wsConnect(urlStr) {
  return new Promise((resolve, reject) => {
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
}
async function evalOn(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? ('ERR:' + (r.result?.exceptionDetails?.exception?.description || '').slice(0, 140));
}
async function evalOnTab(tabPort, needle, expr, which = 0) {
  const ts = (await httpJson(tabPort))?.filter((x) => x.url.includes(needle)) ?? [];
  if (!ts.length) return 'NO_TAB_TARGET';
  const t = ts[which] || ts[ts.length - 1];
  const c = await wsConnect(t.webSocketDebuggerUrl);
  const v = await evalOn(c, expr);
  c.socket.end();
  return v;
}
async function launch() {
  const out = fs.openSync(LOG, 'a');
  spawn(EXE, [], { detached: true, stdio: ['ignore', out, out] }).unref();
  // The release build has no stdout logger — discover the chrome port by
  // scanning its dynamic range (chrome_debug_port(): find_free_port(9220)).
  let chromePort = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !chromePort) {
    await sleep(500);
    for (let p = 9220; p <= 9240 && !chromePort; p++) {
      const t = await httpJson(p);
      if (t?.some((x) => x.url.includes('tauri.localhost'))) chromePort = p;
    }
  }
  if (!chromePort) throw new Error('chrome never came up');
  return chromePort;
}
async function killAll() {
  await ps('Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force');
  await ps(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*BrowserHayDev*resources\\runtimes*' -and ($_.Name -eq 'python.exe' -or $_.Name -eq 'node.exe' -or $_.Name -eq 'tor.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);
  await sleep(3000);
}

await killAll();
try { fs.unlinkSync(LOG); } catch {}

// ---- ROUND 1: write state in the DEFAULT profile
const chromePort1 = await launch();
let cdp = await wsConnect((await httpJson(chromePort1)).find((x) => x.url.includes('tauri.localhost')).webSocketDebuggerUrl);
const tabPort = Number(await evalOn(cdp, `window.__TAURI_INTERNALS__.invoke('browser_debug_port')`));
out.push(`0) chrome port ${chromePort1}, tab port ${tabPort}`);
await evalOn(cdp, `window.__TAURI_INTERNALS__.invoke('browser_tabs_open', {req:{url:'https://example.com'}})`);
await sleep(8000);
out.push('1) WRITE: ' + await evalOnTab(tabPort, 'example.com',
  `localStorage.setItem('hd-persist','v1'); document.cookie='hd-cookie=c1;max-age=86400'; 'ls=' + localStorage.getItem('hd-persist') + ' ck=' + document.cookie`));
// dashboard screenshot (logo check)
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('D:/Projects/BrowserHayDev/qa-shots/tauri-dashboard-logo.png', Buffer.from(shot.result.data, 'base64'));
out.push('2) dashboard screenshot saved');
await evalOn(cdp, `window.__TAURI_INTERNALS__.invoke('window_close')`);
cdp.socket.end();
await sleep(8000);
out.push('3) after close: app=' + await ps('(Get-Process app -ErrorAction SilentlyContinue | Measure-Object).Count') + ' engines=' + await ps(`(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*BrowserHayDev*resources\\runtimes*' } | Measure-Object).Count`));

// ---- ROUND 2: restart and read back
try { fs.unlinkSync(LOG); } catch {}
const chromePort2 = await launch();
cdp = await wsConnect((await httpJson(chromePort2)).find((x) => x.url.includes('tauri.localhost')).webSocketDebuggerUrl);
await evalOn(cdp, `window.__TAURI_INTERNALS__.invoke('browser_tabs_open', {req:{url:'https://example.com'}})`);
await sleep(8000);
const tabPort2 = Number(await evalOn(cdp, `window.__TAURI_INTERNALS__.invoke('browser_debug_port')`));
out.push('4) READ AFTER RESTART: ' + await evalOnTab(tabPort2, 'example.com', `'ls=' + localStorage.getItem('hd-persist') + ' ck=' + document.cookie`));
// example.com favicon/page + tab strip check via chrome shot
const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('D:/Projects/BrowserHayDev/qa-shots/tauri-brand-tabs.png', Buffer.from(shot2.result.data, 'base64'));
await evalOn(cdp, `window.__TAURI_INTERNALS__.invoke('window_close')`);
cdp.socket.end();
await sleep(5000);
console.log(out.join('\n'));