// Vault E2E: save → has → list → generateAndStore → delete через живое приложение.
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
function wsConnect(urlStr) {
  return Promise.race([(new Promise((resolve, reject) => {
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
  })), new Promise((_, rej) => setTimeout(() => rej(new Error('ws timeout')), 12000))]);
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
const cp = await findPort('tauri.localhost', 9220, 9240);
const c = await wsConnect((await httpJson(cp)).find((x) => x.url.includes('tauri.localhost')).webSocketDebuggerUrl);
const inv = async (cmd, args) => {
  const r = await c.send('Runtime.evaluate', {
    expression: `window.__TAURI_INTERNALS__.invoke('${cmd}', ${JSON.stringify(args ?? {})}).then(v=>'OK:'+JSON.stringify(v)).catch(e=>'ERR:'+JSON.stringify(e))`,
    awaitPromise: true, returnByValue: true,
  });
  return r.result?.result?.value ?? 'NOSTRING';
};

await sleep(5000);
const save = await inv('vault_save', { req: { domain: 'example.com', username: 'alice', password: 'S3cret!!' } });
pass('vault_save (DPAPI encrypt + persist)', save.includes('"success":true'), save.slice(0, 110));
const has = await inv('vault_has', { req: { domain: 'example.com', username: 'alice' } });
pass('vault_has → true', has.includes('"has":true'), has.slice(0, 90));
const list = await inv('vault_list');
pass('vault_list hides encrypted blobs', list.includes('"domain":"example.com"') && !list.includes('S3cret'), list.slice(0, 110));
const gen = await inv('vault_generate_and_store', { req: { domain: 'gen.io', username: 'bot', length: 24 } });
pass('vault_generate_and_store', /"success":true/.test(gen) && /"generated":"/.test(gen), gen.slice(0, 110));
const genPass = (gen.match(/"generated":"([^"]+)"/) || [])[1] || '';
pass('generated password length 24', genPass.length === 24, `len=${genPass.length}`);
const del = await inv('vault_delete', { req2: undefined, id: JSON.parse(save.replace('OK:', '')).record.id });
pass('vault_delete', del.includes('"success":true'), del.slice(0, 90));
const file = process.env.APPDATA + '/com.haydev.browser/credentials.vault';
const raw = fs.readFileSync(file, 'utf8');
const j = JSON.parse(raw);
pass('file format: version 1 + records array', j.version === 1 && Array.isArray(j.records), `records=${j.records.length}`);
pass('no plaintext password on disk', !raw.includes('S3cret') && !raw.includes(genPass), 'blobs only');

c.socket.end();
try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} PASS`);
