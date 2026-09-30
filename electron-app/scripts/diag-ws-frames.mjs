// Raw WS frame diagnostics: captureScreenshot frame structure on :9330.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

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
    const frames = [];
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        if (buf.length < 2) break;
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        let mk = null;
        if (masked) { if (buf.length < off + 4) break; mk = buf.subarray(off, off + 4); off += 4; }
        if (buf.length < off + len) break;
        let pl = buf.subarray(off, off + len);
        if (mk) pl = Buffer.from(pl.map((b, i) => b ^ mk[i % 4]));
        buf = buf.subarray(off + len);
        frames.push({ fin, opcode, len });
        if (opcode === 0x1 || opcode === 0x0) { try { const msg = JSON.parse(pl.toString('utf8')); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)({ msg, frames: [...frames] }); pending.delete(msg.id); } } catch {} }
        if (opcode === 0x8) socket.end();
      }
    });
    const send = (method, params = {}, tmo = 60000) => new Promise((res2) => {
      const mid = ++id; const tm = setTimeout(() => { pending.delete(mid); res2({ result: { result: { value: 'TIMEOUT' } } }); }, tmo);
      pending.set(mid, (m2) => { clearTimeout(tm); res2(m2); });
      const body = Buffer.from(JSON.stringify({ id: mid, method, params }));
      const mask = crypto.randomBytes(4);
      let h;
      if (body.length < 126) h = Buffer.from([0x81, 0x80 | body.length]);
      else if (body.length <= 0xffff) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(body.length, 2); }
      else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(body.length), 2); }
      socket.write(Buffer.concat([h, mask, Buffer.from(body.map((b, i) => b ^ mask[i % 4]))]));
    });
    resolve({ send, socket, framesInfo: () => frames.slice(-6) });
  });
  req.on('error', reject); req.end();
});
(async () => {
  try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {}
  await sleep(1500);
  spawn('D:/Projects/BrowserHayDev/electron-app/src-tauri/target/release/app.exe', [], { detached: true, stdio: 'ignore' }).unref();
  await sleep(15000);
  const targets = await httpJson(9330);
  console.log('targets:', (targets || []).map((t) => t.url.slice(0, 40)));
  const t = (targets || []).find((x) => x.url.includes('httpbin')) || (targets || [])[0];
  if (!t) { console.log('no target'); return; }
  const c = await wsConnectRaw(t.webSocketDebuggerUrl);
  await c.send('Page.enable', {}, 20000);
  const r = await c.send('Page.captureScreenshot', { format: 'png' }, 60000);
  console.log('reply keys:', Object.keys(r.result || {}), '| data len:', (r.result?.result?.data || r.result?.data || '').length, '| last frames:', JSON.stringify(c.framesInfo()));
  c.socket.end();
  try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {}
  console.log('DONE');
})();
