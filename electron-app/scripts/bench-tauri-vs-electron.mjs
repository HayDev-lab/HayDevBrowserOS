// Electron vs Tauri benchmark runner — REAL measurements (migration §33).
// Methodology kept honest: warm starts, median of 3, process-TREE RAM sums,
// engine processes (python/node/tor from resources/runtimes) counted separately.
import { execFile, spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const TAURI_EXE = 'D:/Projects/BrowserHayDev/electron-app/src-tauri/target/release/app.exe';
const ELECTRON_EXE = 'D:/Projects/BrowserHayDev/electron-app/out/Personal Agentic Browser-win32-x64/PersonalAgenticBrowser.exe';
const results = { tauri: {}, electron: {} };

function httpJson(port, path = '/json') {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path, timeout: 1500 }, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    }).on('error', () => res(null));
  });
}
async function waitCdp(port, needles, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const targets = await httpJson(port);
    if (targets && targets.some((t) => needles.some((n) => t.url.includes(n)))) return Date.now() - t0;
    await sleep(250);
  }
  return -1;
}
function ps(expr) {
  return new Promise((res) => {
    execFile('powershell', ['-NoProfile', '-Command', expr], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => res(err ? null : stdout.trim()));
  });
}
// Sum WorkingSet of a process tree starting at rootPid
async function treeRamMb(rootPid) {
  const out = await ps(
    `function Walk($p){ $sum=0; try{ $sum+=[math]::Round((Get-Process -Id $p -ErrorAction Stop).WorkingSet64/1MB,1) }catch{}; Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" -ErrorAction SilentlyContinue | ForEach-Object { $sum += Walk $_.ProcessId }; return $sum }; Walk ${rootPid}`
  );
  return out ? Number(out) : null;
}
async function pidsByName(name) {
  const out = await ps(`(Get-Process ${name} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','`);
  return (out || '').split(',').filter(Boolean).map(Number);
}
async function findPidByCmd(nameLike, exeName) {
  const out = await ps(
    `(Get-CimInstance Win32_Process -Filter "Name='${exeName}'" | Where-Object { $_.CommandLine -like '${nameLike}' } | Select-Object -First 1 -ExpandProperty ProcessId)`
  );
  return out ? Number(out) : null;
}
async function engineRamMb() {
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
async function driveOpenTabs(port, needles, engine, n) {
  const targets = await httpJson(port);
  const t = targets.find((x) => needles.some((n) => x.url.includes(n)));
  if (!t) throw new Error('no chrome target');
  const cdp = await wsConnect(t.webSocketDebuggerUrl);
  const expr = engine === 'tauri'
    ? `window.__TAURI_INTERNALS__.invoke('browser_tabs_open', {req:{url:'https://example.com'}})`
    : `window.api.browser.openTab({url:'https://example.com'})`;
  for (let i = 0; i < n; i++) {
    await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    await sleep(2500);
  }
  cdp.socket.end();
}
async function stopApp(name) {
  if (name === 'tauri') await ps('Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force');
  else await ps(`Get-Process PersonalAgenticBrowser -ErrorAction SilentlyContinue | Stop-Process -Force`);
  await ps(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*runtimes*' -and ($_.Name -eq 'python.exe' -or $_.Name -eq 'node.exe' -or $_.Name -eq 'tor.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);
  await sleep(3000);
}

const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function bench(label, exe, args, cdpPort, needles, engine, pidFinder) {
  // warm startup x3
  const startups = [];
  for (let i = 0; i < 3; i++) {
    await stopApp(engine === 'tauri' ? 'tauri' : 'electron');
    spawn(exe, args, { detached: true, stdio: 'ignore', shell: false }).unref();
    const ms = await waitCdp(cdpPort, needles, 45000);
    startups.push(ms);
    if (i < 2) await stopApp(engine === 'tauri' ? 'tauri' : 'electron');
  }
  // keep the last instance for RAM
  await sleep(45000); // settle + engines boot
  const rootPid = await pidFinder();
  const ramIdleTree = rootPid ? await treeRamMb(rootPid) : null;
  const ramEngines = await engineRamMb();
  // 3 tabs
  try { await driveOpenTabs(cdpPort, needles, engine, 3); } catch (e) { console.error(label, 'tabs-drive:', e.message); }
  await sleep(15000);
  const ram3tabsTree = rootPid ? await treeRamMb(rootPid) : null;
  await stopApp(engine === 'tauri' ? 'tauri' : 'electron');
  results[engine] = {
    startupMsWarm: startups,
    startupMedian: median(startups.filter((x) => x > 0)),
    ramIdleTreeMb: ramIdleTree,
    ramIdleEnginesMb: ramEngines,
    ramIdleHostMb: ramIdleTree != null ? Math.round((ramIdleTree - ramEngines) * 10) / 10 : null,
    ram3TabsTreeMb: ram3tabsTree,
    ram3TabsHostMb: ram3tabsTree != null ? Math.round((ram3tabsTree - ramEngines) * 10) / 10 : null,
  };
}

// ---- Electron first ----
await bench('Electron', ELECTRON_EXE, ['--remote-debugging-port=9224'], 9224, ['file://', 'pab://', 'localhost'], 'electron',
  async () => (await pidsByName('PersonalAgenticBrowser'))[0]);
// ---- Tauri ----
process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223';
await bench('Tauri', TAURI_EXE, [], 9223, ['tauri.localhost', 'pab.'], 'tauri',
  async () => (await pidsByName('app'))[0]);

console.log(JSON.stringify(results, null, 2));
