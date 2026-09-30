// Electron-only re-measurement with CORRECT root-pid detection:
// root = the PersonalAgenticBrowser process whose parent is NOT itself a
// PersonalAgenticBrowser process (the browser root spawns the rest).
import { execFile, spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const ELECTRON_EXE = 'D:/Projects/BrowserHayDev/electron-app/out/Personal Agentic Browser-win32-x64/PersonalAgenticBrowser.exe';

function ps(expr) {
  return new Promise((res) => {
    execFile('powershell', ['-NoProfile', '-Command', expr], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => res(err ? null : stdout.trim()));
  });
}
function httpJson(port) {
  return new Promise((res) => {
    http.get({ host: '127.0.0.1', port, path: '/json', timeout: 1500 }, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    }).on('error', () => res(null));
  });
}
async function waitCdp(port, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const t = await httpJson(port);
    if (t && t.length) return Date.now() - t0;
    await sleep(250);
  }
  return -1;
}
async function treeRamMb(rootPid) {
  const out = await ps(
    `function Walk($p){ $sum=0; try{ $sum+=[math]::Round((Get-Process -Id $p -ErrorAction Stop).WorkingSet64/1MB,1) }catch{}; Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" -ErrorAction SilentlyContinue | ForEach-Object { $sum += Walk $_.ProcessId }; return $sum }; Walk ${rootPid}`
  );
  return out ? Number(out) : null;
}
async function electronRootPid() {
  const out = await ps(
    `$procs = Get-CimInstance Win32_Process -Filter "Name='PersonalAgenticBrowser.exe'"; $ids = $procs.ProcessId; ($procs | Where-Object { $ids -notcontains $_.ParentProcessId } | Select-Object -First 1).ProcessId`
  );
  return out ? Number(out) : null;
}
async function enginesRamMb() {
  const out = await ps(
    `function Walk($p){ $sum=0; try{ $sum+=[math]::Round((Get-Process -Id $p -ErrorAction Stop).WorkingSet64/1MB,1) }catch{}; Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" -ErrorAction SilentlyContinue | ForEach-Object { $sum += Walk $_.ProcessId }; return $sum }; $t=0; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*runtimes*' -and ($_.Name -eq 'python.exe' -or $_.Name -eq 'node.exe' -or $_.Name -eq 'tor.exe') } | ForEach-Object { $t += Walk $_.ProcessId }; [math]::Round($t,1)`
  );
  return out ? Number(out) : 0;
}
function wsConnect(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const key = crypto.randomUUID().replace(/-/g, '');
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': Buffer.from(key).toString('base64'), 'Sec-WebSocket-Version': 13 } });
    req.on('upgrade', (res, socket) => {
      let buf = Buffer.alloc(0); let id = 0; const pending = new Map();
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (true) {
          if (buf.length < 2) break;
          const b0 = buf[0], b1 = buf[1]; const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
          let len = b1 & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          let maskKey = null;
          if (masked) { if (buf.length < off + 4) break; maskKey = buf.subarray(off, off + 4); off += 4; }
          if (buf.length < off + len) break;
          let payload = buf.subarray(off, off + len);
          if (maskKey) payload = Buffer.from(payload.map((b, i) => b ^ maskKey[i % 4]));
          buf = buf.subarray(off + len);
          if (opcode === 0x1 || opcode === 0x0) { try { const msg = JSON.parse(payload.toString('utf8')); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } } catch {} }
          if (opcode === 0x8) socket.end();
        }
      });
      const send = (method, params = {}) => new Promise((res2) => {
        const mid = ++id; pending.set(mid, res2);
        const body = Buffer.from(JSON.stringify({ id: mid, method, params }));
        const mask = crypto.randomBytes(4);
        let header;
        if (body.length < 126) header = Buffer.from([0x81, 0x80 | body.length]);
        else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(body.length, 2); }
        socket.write(Buffer.concat([header, mask, Buffer.from(body.map((b, i) => b ^ mask[i % 4]))]));
      });
      resolve({ send, socket });
    });
    req.on('error', reject); req.end();
  });
}

// kill leftovers
await ps(`Get-Process PersonalAgenticBrowser,app -ErrorAction SilentlyContinue | Stop-Process -Force`);
await ps(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*runtimes*' -and ($_.Name -eq 'python.exe' -or $_.Name -eq 'node.exe' -or $_.Name -eq 'tor.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);
await sleep(3000);

// startup x3 (warm)
const startups = [];
for (let i = 0; i < 3; i++) {
  spawn(ELECTRON_EXE, ['--remote-debugging-port=9224'], { detached: true, stdio: 'ignore' }).unref();
  startups.push(await waitCdp(9224, 45000));
  await ps(`Get-Process PersonalAgenticBrowser -ErrorAction SilentlyContinue | Stop-Process -Force`);
  await ps(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*runtimes*' -and ($_.Name -eq 'python.exe' -or $_.Name -eq 'node.exe' -or $_.Name -eq 'tor.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);
  await sleep(2500);
}
// final launch for RAM
spawn(ELECTRON_EXE, ['--remote-debugging-port=9224'], { detached: true, stdio: 'ignore' }).unref();
await waitCdp(9224, 45000);
await sleep(45000);
const rootPid = await electronRootPid();
const ramIdleTree = rootPid ? await treeRamMb(rootPid) : null;
const ramEngines = await enginesRamMb();

// 3 tabs via the app's own bridge
let tabsOk = 0;
try {
  const targets = await httpJson(9224);
  const t = targets.find((x) => x.url.includes('file://') || x.url.includes('pab'));
  const cdp = await wsConnect(t.webSocketDebuggerUrl);
  for (let i = 0; i < 3; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: `window.api.browser.openTab({url:'https://example.com'}).then(()=>'ok').catch(e=>'err ' + e.message.slice(0,60))`, awaitPromise: true, returnByValue: true });
    if (r.result?.result?.value === 'ok') tabsOk++;
    await sleep(2500);
  }
  cdp.socket.end();
} catch (e) { console.error('tabs-drive:', e.message); }
await sleep(15000);
const ram3tabsTree = rootPid ? await treeRamMb(rootPid) : null;

await ps(`Get-Process PersonalAgenticBrowser -ErrorAction SilentlyContinue | Stop-Process -Force`);
await ps(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*runtimes*' -and ($_.Name -eq 'python.exe' -or $_.Name -eq 'node.exe' -or $_.Name -eq 'tor.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);

console.log(JSON.stringify({
  rootPid, startups, tabsOk,
  ramIdleTreeMb: ramIdleTree, ramEnginesMb: ramEngines,
  ramIdleHostMb: ramIdleTree != null ? Math.round((ramIdleTree - ramEngines) * 10) / 10 : null,
  ram3TabsTreeMb: ram3tabsTree,
  ram3TabsHostMb: ram3tabsTree != null ? Math.round((ram3tabsTree - ramEngines) * 10) / 10 : null,
}, null, 2));