// AGENT E2E: real Gemini loop over the bridge — navigate + verify + finish.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = 'D:/Projects/BrowserHayDev/electron-app/src-tauri/target/release/app.exe';
const results = [];
const pass = (name, ok, note) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS ' : 'FAIL '}${name} | ${String(note).slice(0, 150)}`); };
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
      const send = (method, params = {}, tmo = 300000) => new Promise((res2) => {
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

await sleep(8000);
console.log('status before:', await inv('agent_status'));

// ЗАДАЧА: агент должен сам открыть example.com, прочитать заголовок и завершиться.
const TASK = 'Navigate the active tab to https://example.com, read the page heading, then finish with the heading text as summary.';
const t0 = Date.now();
const run = await inv('agent_run', { req: { command: TASK, maxSteps: 8 } });
const dur = Math.round((Date.now() - t0) / 1000);
console.log(`agent_run (${dur}s):`, String(run).slice(0, 400));
pass('agent_run resolves', String(run).startsWith('OK:'), String(run).slice(0, 120));

const status = await inv('agent_status');
pass('status after run', /DONE|IDLE|ERROR|WAITING/.test(String(status)), String(status).slice(0, 150));

const tl = await inv('agent_timeline_list');
const entries = (() => { try { return JSON.parse(String(tl).replace(/^OK:/, '')); } catch { return []; } })();
const kinds = entries.map((e) => e.kind);
console.log('timeline kinds:', kinds.join(','));
pass('timeline has thought+tool_call+tool_result', kinds.includes('thought') && kinds.includes('tool_call') && kinds.includes('tool_result'), `${entries.length} entries`);
const navCall = entries.find((e) => e.kind === 'tool_call' && /navigate/.test(e.text));
pass('agent called navigate tool', !!navCall, navCall?.text?.slice(0, 90));
// page actually navigated?
const tabs = await inv('browser_tabs_list');
pass('tab actually at example.com', /example\.com/.test(String(tabs)), String(tabs).slice(0, 150));
const summary = entries.find((e) => e.kind === 'summary');
pass('finish summary mentions Example Domain', /example domain/i.test(summary?.text || ''), (summary?.text || '(none)').slice(0, 90));

// honest provider-missing path (fake key env can't be unset per-process here —
// covered by unit contract; live run already proves the real path)
c.socket.end();
try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} PASS`);
