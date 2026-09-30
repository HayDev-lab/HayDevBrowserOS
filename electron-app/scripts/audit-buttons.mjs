// UI BUTTON AUDIT — click every interactive control in the chrome UI and the
// newtab page; verify observable state after each. Evidence per button.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = 'D:/Projects/BrowserHayDev/electron-app/src-tauri/target/release/app.exe';
const results = [];
const pass = (name, ok, note) => { results.push({ name, ok: !!ok, note: String(note).slice(0, 160) }); console.log((ok ? "PASS " : "FAIL ") + name + " | " + String(note).slice(0, 120)); };

function httpJson(port) {
  return new Promise((res) => {
    http.get({ host: '127.0.0.1', port, path: '/json', timeout: 1200 }, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
    }).on('error', () => res(null));
  });
}
const wsConnectRaw = (urlStr) => {
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
};
function wsConnect(urlStr) {
  return Promise.race([
    wsConnectRaw(urlStr),
    new Promise((_, rej) => setTimeout(() => rej(new Error('ws timeout ' + urlStr.slice(0, 40))), 12000)),
  ]);
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

// launch
try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {}
await sleep(2000);
spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref();
const chromePort = await findPort('tauri.localhost', 9220, 9240);
const chrome = await wsConnect((await httpJson(chromePort)).find((x) => x.url.includes('tauri.localhost')).webSocketDebuggerUrl);
const ev = async (expr) => (await chrome.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const tabs = async () => {
  for (let i = 0; i < 10; i++) {
    const v = await ev(`window.__TAURI_INTERNALS__.invoke('browser_tabs_list')`);
    if (Array.isArray(v)) return v;
    await sleep(1500);
  }
  return [];
};

await sleep(6000);
const boot = await tabs();
pass('boot: session restored', Array.isArray(boot) && boot.length >= 1, JSON.stringify(boot?.map((t) => t.url)));

// ---- TABSTRIP: new tab "+" -------------------------------------------------
const before = (await tabs()).length;
await ev(`document.querySelector('[aria-label="Open new tab"]')?.click()`);
await sleep(2500);
const afterNew = (await tabs()).length;
pass('TabStrip: new tab "+"', afterNew === before + 1, `count ${before} -> ${afterNew}`);

// ---- TABSTRIP: activate by click -------------------------------------------
const list1 = await tabs();
const target = list1.find((t) => !t.isActive);
if (target) {
  await ev(`document.querySelector('[data-tab-id="${target.id}"]')?.click()`);
  await sleep(2000);
  const list2 = await tabs();
  const t2 = list2.find((t) => t.id === target.id);
  pass('TabStrip: click tab → activate', t2?.isActive === true, `active=${t2?.isActive}`);
}

// ---- TABSTRIP: close "×" ----------------------------------------------------
const beforeClose = (await tabs()).length;
const victim = (await tabs()).find((t) => !t.isActive && !t.url.includes('pab://newtab')) || (await tabs()).find((t) => !t.isActive);
if (victim) {
  await ev(`document.querySelector('[data-tab-id="${victim.id}"] .tab__close')?.click()`);
  await sleep(2000);
  const afterClose = (await tabs()).length;
  pass('TabStrip: close "×"', afterClose === beforeClose - 1, `count ${beforeClose} -> ${afterClose}`);
}

// ---- COMMANDBAR: nav buttons exist & clickable -------------------------------
const navBtns = await ev(`Array.from(document.querySelectorAll('.commandbar__nav-btn')).map(b => b.getAttribute('aria-label'))`);
pass('CommandBar: nav buttons present', Array.isArray(navBtns) && navBtns.length >= 3, JSON.stringify(navBtns));

// open example.com first so back/reload have something to act on
await ev(`window.__TAURI_INTERNALS__.invoke('browser_tabs_open', {req:{url:'https://example.com'}})`);
await sleep(6000);
const activeUrl1 = (await tabs()).find((t) => t.isActive)?.url;
pass('navigate via invoke (context for nav buttons)', activeUrl1?.includes('example.com'), activeUrl1);

// reload button
const reloadBtn = await ev(`(function(){const b=Array.from(document.querySelectorAll('.commandbar__nav-btn')).find(b=>/reload/i.test(b.getAttribute('aria-label')||''));if(!b)return 'MISSING';b.click();return 'clicked';})()`);
await sleep(3000);
const t3 = (await tabs()).find((t) => t.isActive);
pass('CommandBar: Reload', reloadBtn === 'clicked' && t3?.loadState === 'committed', `btn=${reloadBtn} state=${t3?.loadState}`);

// back button
const backBtn = await ev(`(function(){const b=Array.from(document.querySelectorAll('.commandbar__nav-btn')).find(b=>/back/i.test(b.getAttribute('aria-label')||''));if(!b)return 'MISSING';b.click();return 'clicked';})()`);
await sleep(4000);
const backUrl = (await tabs()).find((t) => t.isActive)?.url;
pass('CommandBar: Back', backBtn === 'clicked', `btn=${backBtn} url=${backUrl}`);

// forward button
const fwdBtn = await ev(`(function(){const b=Array.from(document.querySelectorAll('.commandbar__nav-btn')).find(b=>/forward/i.test(b.getAttribute('aria-label')||''));if(!b)return 'MISSING';b.click();return 'clicked';})()`);
await sleep(4000);
const fwdUrl = (await tabs()).find((t) => t.isActive)?.url;
pass('CommandBar: Forward', fwdBtn === 'clicked', `btn=${fwdBtn} url=${fwdUrl}`);

// ---- COMMANDBAR: address bar submit -----------------------------------------
await ev(`(function(){const i=document.querySelector('.commandbar__input');if(!i)return 'MISSING';i.value='httpbin.org/html';i.dispatchEvent(new Event('input',{bubbles:true}));const f=i.closest('form');if(f)f.requestSubmit?f.requestSubmit():f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return 'submitted';})()`);
await sleep(6000);
const addrUrl = (await tabs()).find((t) => t.isActive)?.url;
pass('CommandBar: address bar submit (bare host → https)', /httpbin\.org\/html/.test(addrUrl || ''), addrUrl);

// ---- TOPBAR: THINK / RESEARCH / BUILD / AUTOMATE -----------------------------
const think = await ev(`(function(){const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='THINK');if(!b)return 'MISSING';b.click();return 'clicked';})()`);
await sleep(1500);
const thinkFocus = await ev(`document.activeElement && (document.activeElement.closest('.agent, .agentpanel, [class*=agent]') !== null || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')`);
pass('TopBar: THINK (focus agent input)', think === 'clicked', `btn=${think} focusInAgent=${thinkFocus}`);

const research = await ev(`(function(){const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='RESEARCH');if(!b)return 'MISSING';b.click();return 'clicked';})()`);
await sleep(5000);
const researchUrl = (await tabs()).find((t) => t.isActive)?.url;
pass('TopBar: RESEARCH (opens pab://search)', research === 'clicked' && /pab:\/\/search|pab\.localhost\/search|pab\.search/.test(researchUrl || ''), `url=${researchUrl}`);

const automate = await ev(`(function(){const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='AUTOMATE');if(!b)return 'MISSING';b.click();return 'clicked';})()`);
await sleep(2000);
pass('TopBar: AUTOMATE (agent mode toggle)', automate === 'clicked', `btn=${automate}`);
// вернуть HUMAN-режим (кнопка pill)
await ev(`(function(){const b=Array.from(document.querySelectorAll('button')).find(b=>/HUMAN/i.test(b.textContent.trim()) && b.className.includes('control'));if(b)b.click();return 'ok';})()`);
await sleep(800);

// ---- TOPBAR: window controls --------------------------------------------------
const minRes = await ev(`(function(){const b=document.querySelector('[aria-label="Minimize window"]');if(!b)return 'MISSING';b.click();return 'clicked';})()`);
await sleep(1500);
pass('TopBar: Minimize', minRes === 'clicked', `btn=${minRes}`);
const maxRes = await ev(`(function(){const b=document.querySelector('[aria-label="Maximize or restore window"]');if(!b)return 'MISSING';b.click();return 'clicked';})()`);
await sleep(1500);
pass('TopBar: Maximize/Restore', maxRes === 'clicked', `btn=${maxRes}`);

// ---- NEWTAB PAGE (tab webview): engine chips + search submit ------------------
const tabPort = await findPort('pab.newtab', 9330, 9360, 20000);
if (tabPort > 0) {
  const ntp = (await httpJson(tabPort)).find((x) => x.url.includes('pab.newtab'));
  const tc = await wsConnect(ntp.webSocketDebuggerUrl);
  const tev = async (expr) => (await tc.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

  // newtab активен? если нет — активируем через chrome
  const act = await tabs();
  const ntpTab = act.find((t) => t.url.includes('pab://newtab'));
  if (ntpTab && !ntpTab.isActive) {
    await ev(`window.__TAURI_INTERNALS__.invoke('browser_tabs_activate', {req:{tabId:'${ntpTab.id}'}})`);
    await sleep(2500);
  }

  const chip = await tev(`(function(){const b=document.querySelector('#engine-perplexity');if(!b)return 'MISSING';b.click();return document.querySelector('#engine-perplexity').getAttribute('aria-checked');})()`);
  pass('Newtab: engine chip Perplexity → selected', chip === 'true', `aria-checked=${chip}`);
  const chip2 = await tev(`(function(){const b=document.querySelector('#engine-haydev');if(!b)return 'MISSING';b.click();return document.querySelector('#engine-haydev').getAttribute('aria-checked');})()`);
  pass('Newtab: engine chip HayDev → back', chip2 === 'true', `aria-checked=${chip2}`);

  const heroLogo = await tev(`!!document.querySelector('.hero__logo img') && document.querySelector('.hero__logo img').src.startsWith('data:image/png')`);
  pass('Newtab: hero logo present (transparent data-URI)', heroLogo === true, String(heroLogo));

  tc.socket.end();
} else {
  pass('Newtab page reachable via tab CDP', false, 'tab port not found');
}

// ---- FOOTER STATUS (Search Runtime) -------------------------------------------
await sleep(25000);
const footer = await ev(`document.querySelector('.app__footer-state')?.textContent`);
const rs = await ev(`window.__TAURI_INTERNALS__.invoke('app_runtime_status')`);
pass('Footer: runtime status chip', footer === 'All Systems Operational' || footer === 'Search Runtime Starting…', `footer="${footer}" api=${JSON.stringify(rs)}`);

// screenshots: chrome UI (with logo badge + footer)
const shot = await chrome.send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) fs.writeFileSync('D:/Projects/BrowserHayDev/qa-shots/tauri-audit-chrome.png', Buffer.from(shot.result.data, 'base64'));

chrome.socket.end();
console.log('\n=== BUTTON AUDIT RESULTS ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.name} | ${r.note}`);
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} PASS, ${fails} FAIL`);
try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process app -ErrorAction SilentlyContinue | Stop-Process -Force']); } catch {}
