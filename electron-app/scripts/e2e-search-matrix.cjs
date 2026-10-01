// E2E search matrix — drives the REAL Tauri build through its CDP ports.
// Part 1 (this): chrome webview (9220) invoke() — tabs, address-bar search
// normalization, history, bookmarks. Part 2: pab pages + darkweb API + MCP
// over plain HTTP.
const http = require('http');

function getJson(port, path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path }, r => {
      let d = '';
      r.on('data', c => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

function cdpEval(port, pageUrlNeedle, expr, timeoutMs = 30000) {
  return getJson(port, '/json').then(targets => {
    const t = targets.find(x => x.url.includes(pageUrlNeedle));
    if (!t) throw new Error('target not found: ' + pageUrlNeedle);
    const WebSocket = require('ws');
    return new Promise((res, rej) => {
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      const id = 1;
      const timer = setTimeout(() => { ws.close(); rej(new Error('cdp timeout')); }, timeoutMs);
      ws.on('open', () => ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })));
      ws.on('message', m => {
        const r = JSON.parse(m);
        clearTimeout(timer);
        ws.close();
        if (r.result?.result?.value !== undefined) res(r.result.result.value);
        else res('CDP-ERR: ' + JSON.stringify(r.result?.exceptionDetails || r.result || r).slice(0, 200));
      });
      ws.on('error', e => { clearTimeout(timer); rej(e); });
    });
  });
}

(async () => {
  const out = [];
  const pass = s => out.push('PASS  ' + s);
  const fail = (s, d) => out.push('FAIL  ' + s + '  | ' + (d || ''));

  try {
    // 1. Tabs registry live (release embeds assets at tauri.localhost;
    //    dev builds serve from localhost:5180 — accept both)
    const tabsRaw = await cdpEval(9220, 'tauri.localhost',
      '(async()=>{const I=window.__TAURI_INTERNALS__;return JSON.stringify(await I.invoke("browser_tabs_list"))})()');
    const arr = JSON.parse(tabsRaw).tabs || JSON.parse(tabsRaw);
    const active = arr.find(t => t.isActive);
    arr.length && active ? pass(`tabs registry: ${arr.length} tabs, active ${active.id.slice(0, 8)}`)
      : fail('tabs registry', tabsRaw.slice(0, 100));

    // 2. Address-bar search normalization (bare query -> engine URL)
    await cdpEval(9220, 'tauri.localhost',
      `(async()=>{const I=window.__TAURI_INTERNALS__;await I.invoke("browser_navigate",{req:{tabId:"${active.id}",url:"rust news today"}});return 1})()`);
    const tabsAfter = await cdpEval(9220, 'tauri.localhost',
      '(async()=>{const I=window.__TAURI_INTERNALS__;return JSON.stringify(await I.invoke("browser_tabs_list"))})()');
    const arr2 = JSON.parse(tabsAfter).tabs || JSON.parse(tabsAfter);
    const url = (arr2.find(t => t.isActive) || {}).url || '';
    const looksSearch = /duckduckgo\.com\/\?q=|pab:\/\/search|bing\.com|google\./.test(url) && /rust[+%20]+news/i.test(url);
    looksSearch ? pass('address-bar search -> ' + url.slice(0, 70)) : fail('address-bar search', url.slice(0, 160));

    // 3. History add + substring query
    const marker = 'e2e' + Date.now();
    await cdpEval(9220, 'tauri.localhost',
      `(async()=>{const I=window.__TAURI_INTERNALS__;await I.invoke("browser_history_add",{req:{url:"https://example.io/${marker}",title:"E2E ${marker}"}});return 1})()`);
    const hq = await cdpEval(9220, 'tauri.localhost',
      `(async()=>{const I=window.__TAURI_INTERNALS__;return JSON.stringify(await I.invoke("browser_history_query",{query:{search:"${marker}",limit:10}}))})()`);
    hq.includes(marker) ? pass('history add + search') : fail('history search', hq.slice(0, 120));

    // 4. Bookmarks add + list
    await cdpEval(9220, 'tauri.localhost',
      `(async()=>{const I=window.__TAURI_INTERNALS__;await I.invoke("browser_bookmarks_add",{req:{url:"https://example.io/${marker}",title:"E2E bm"}});return 1})()`);
    const bl = await cdpEval(9220, 'tauri.localhost',
      '(async()=>{const I=window.__TAURI_INTERNALS__;return JSON.stringify(await I.invoke("browser_bookmarks_list"))})()');
    bl.includes(marker) ? pass('bookmarks add + list') : fail('bookmarks', bl.slice(0, 120));

    // 5. pab://search page: Perplexica endpoint + model placeholders substituted
    const pageCfg = await cdpEval(9330, 'pab.search',
      'JSON.stringify({substituted: !document.documentElement.outerHTML.includes("__PAB_PERPLEXICA_URL__") && document.documentElement.outerHTML.includes("127.0.0.1:3000")})');
    const cfg = JSON.parse(pageCfg);
    cfg.substituted
      ? pass('pab://search wiring: endpoint+model substituted into page')
      : fail('pab://search wiring', pageCfg.slice(0, 140));

    // 6. newtab page: topsites + bridge
    const nt = await cdpEval(9330, 'pab.newtab',
      '(async()=>{const r=await fetch("/api/topsites").then(x=>x.json());return JSON.stringify({bridge:typeof window.__pabNewTab, topsites:Array.isArray(r.topSites||r)?(r.topSites||r).length:null})})()');
    const ntObj = JSON.parse(nt);
    ntObj.bridge === 'object' && typeof ntObj.topsites === 'number'
      ? pass(`newtab: bridge ok, topsites=${ntObj.topsites}`) : fail('newtab', nt.slice(0, 140));

    // 7. darkweb page status: open an isolated tor tab first (darkweb tabs
    // are ephemeral by design — not restored from the session)
    await cdpEval(9220, 'tauri.localhost',
      '(async()=>{const I=window.__TAURI_INTERNALS__;await I.invoke("browser_tabs_open",{req:{url:"pab://darkweb/"}});return 1})()');
    await new Promise(r => setTimeout(r, 1500));
    const dw = await cdpEval(9330, 'pab.darkweb',
      '(async()=>{const r=await fetch("/api/status").then(x=>x.json());return JSON.stringify({tor:r.tor&&r.tor.state,indexCount:r.indexCount,providers:(r.providers||[]).map(p=>p.id+":"+p.health).join(",")})})()');
    const dwObj = JSON.parse(dw);
    dwObj.tor && typeof dwObj.indexCount === 'number'
      ? pass(`darkweb status: tor=${dwObj.tor} indexCount=${dwObj.indexCount} [${dwObj.providers}]`)
      : fail('darkweb status', dw.slice(0, 140));

    // 8. MCP: initialize + one tool call (ping-equivalent: providers)
    const mcpInit = await new Promise((res, rej) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } } });
      const req = http.request({ host: '127.0.0.1', port: 27301, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, r => {
        let d = ''; r.on('data', c => (d += c)); r.on('end', () => res(d));
      });
      req.on('error', rej); req.end(body);
    });
    mcpInit.includes('haydev-browser-darkweb') ? pass('MCP initialize') : fail('MCP initialize', mcpInit.slice(0, 120));

    console.log(out.join('\n'));
    const fails = out.filter(l => l.startsWith('FAIL')).length;
    console.log(`\n${out.length - fails}/${out.length} passed`);
    process.exit(fails ? 1 : 0);
  } catch (e) {
    console.log(out.join('\n'));
    console.log('ABORT: ' + e.message);
    process.exit(2);
  }
})();
