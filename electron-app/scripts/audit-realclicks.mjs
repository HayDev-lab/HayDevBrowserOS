// REAL-mouse-click audit: SendInput at screen coords, verify state changes.
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const PSH = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W2 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
`;
const ps = (expr) =>
  execFileSync('powershell', ['-NoProfile', '-Command', PSH + '\n' + expr], { encoding: 'utf8' }).trim();

function httpJson(port) {
  return new Promise((res) => {
    http.get({ host: '127.0.0.1', port, path: '/json', timeout: 1200 }, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    }).on('error', () => res(null));
  });
}
function wsConnect(urlStr) {
  return Promise.race([(new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
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
  })), new Promise((_, rej) => setTimeout(() => rej(new Error('ws timeout')), 12000))]);
}

// focus + rect in ONE call (types defined in the same process)
const rectOut = ps(`
$p = Get-Process app -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output 'NO_WINDOW'; exit }
[W2]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[W2]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 700
$r = New-Object W2+RECT
[W2]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
Write-Output ($r.Left.ToString() + ' ' + $r.Top + ' ' + $r.Right + ' ' + $r.Bottom)
`);
if (rectOut === 'NO_WINDOW' || !/^-?\d+/.test(rectOut)) {
  console.log('no desktop window:', rectOut);
  process.exit(1);
}
const [wl, wt, wr, wb] = rectOut.split(/\s+/).map(Number);
console.log('window rect:', wl, wt, wr, wb);

const targets = await httpJson(9220);
const c = await wsConnect(targets.find((x) => x.url.includes('tauri.localhost')).webSocketDebuggerUrl);
const ev = async (expr) => (await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

const dpr = Number(await ev(`window.devicePixelRatio`)) || 1;
console.log('devicePixelRatio:', dpr);

const rects = JSON.parse(await ev(`(function(){
  function r(sel){ var el=document.querySelector(sel); if(!el) return null; var b=el.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; }
  function rText(t){ var el=Array.from(document.querySelectorAll('button')).find(function(b){return b.textContent.trim()===t;}); if(!el) return null; var b=el.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; }
  return JSON.stringify({
    think: rText('THINK'),
    newtab: r('[aria-label="Open new tab"]'),
    human: rText('HUMAN'),
    agent: rText('AGENT'),
    history: rText('HISTORY')
  });
})()`));
console.log('rects:', JSON.stringify(rects));

const realClick = (clientX, clientY) => {
  const sx = Math.round(wl + clientX * dpr);
  const sy = Math.round(wt + clientY * dpr);
  ps(`
[M]::SetCursorPos(${sx}, ${sy}) | Out-Null
Start-Sleep -Milliseconds 150
[M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
`);
  return { sx, sy };
};

const out = [];
const tabsArr = async () => JSON.parse(await ev(`window.__TAURI_INTERNALS__.invoke('browser_tabs_list').then(v=>JSON.stringify(v))`));

// 1) "+" new tab
const before = (await tabsArr()).length;
realClick(rects.newtab.x, rects.newtab.y);
await sleep(2500);
const after = (await tabsArr()).length;
out.push(`REAL CLICK "+": tabs ${before} -> ${after} = ${after === before + 1 ? 'WORKS' : 'DEAD'}`);

// 2) AGENT pill visual toggle
const clsBefore = await ev(`(function(){var b=Array.from(document.querySelectorAll('button')).find(function(b){return b.textContent.trim()==='AGENT';}); return b.className;})()`);
realClick(rects.agent.x, rects.agent.y);
await sleep(1500);
const clsAfter = await ev(`(function(){var b=Array.from(document.querySelectorAll('button')).find(function(b){return b.textContent.trim()==='AGENT';}); return b.className;})()`);
out.push(`REAL CLICK AGENT: classChanged=${clsBefore !== clsAfter} ${clsBefore !== clsAfter ? 'WORKS' : 'DEAD'}`);

// 3) hit-test: what element is actually under the cursor at AGENT point
const hover = await ev(`(function(){var b=Array.from(document.querySelectorAll('button')).find(function(b){return b.textContent.trim()==='AGENT';}); var r=b.getBoundingClientRect(); var el=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return (el===b||b.contains(el))?'button':'OTHER:'+(el?el.tagName+'.'+String(el.className).slice(0,60):'null');})()`);
out.push(`HIT-TEST AGENT point: ${hover}`);

// 4) same hit-test at HISTORY point (toolbar middle)
const hover2 = await ev(`(function(){var b=Array.from(document.querySelectorAll('button')).find(function(b){return b.textContent.trim().indexOf('HISTORY')>=0;}); if(!b) return 'no-history-btn'; var r=b.getBoundingClientRect(); var el=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return (el===b||b.contains(el))?'button':'OTHER:'+(el?el.tagName+'.'+String(el.className).slice(0,60):'null');})()`);
out.push(`HIT-TEST HISTORY point: ${hover2}`);

// 5) what element is at tabstrip point and at toolbar-left (address bar)
const zones = JSON.parse(await ev(`(function(){
  function at(x,y){ var el=document.elementFromPoint(x,y); return el?el.tagName+'.'+String(el.className).slice(0,40):'null'; }
  return JSON.stringify({ titlebar: at(400,20), tabstrip: at(300,64), toolbar: at(400,106), footer: at(400,document.innerHeight||window.innerHeight-12) });
})()`));
out.push(`ZONE HIT-TESTS: ${JSON.stringify(zones)}`);

console.log('\n=== REAL CLICK AUDIT ===');
out.forEach((l) => console.log(l));
c.socket.end();
