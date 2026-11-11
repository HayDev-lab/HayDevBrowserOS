import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import path from 'node:path';
import { AppHandle } from '../../scripts/e2e/harness.mjs';

async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function poll(read, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail(typeof message === 'function' ? message() : message);
}

test('Arman VPN WebView2 loop: attach, browse, fail closed, recover, detach and repeat', { timeout: 180_000 }, async t => {
  const app = new AppHandle();
  const token = 'ab'.repeat(32);
  const requests = [];
  const proxyRequests = [];
  const upstreamPorts = new Set();
  const proxySockets = new Set();
  let companionDir;
  let socksPort;
  let routing = true;
  let systemProxy = 'clear';
  let selectedCountry = '';
  let policyUpdates = 0;
  let locationUpdates = 0;
  let running = false;
  let accountCount = 0;
  let powerRequests = 0;
  let testOK = false;
  let tunnelTests = 0;
  let dashboardSession = false;
  const dashboardPages = [];
  const dashboardCode = 'cd'.repeat(32);

  const site = http.createServer((req, res) => {
    const via = upstreamPorts.has(req.socket.remotePort) ? 'socks' : 'direct';
    requests.push({ url: req.url, via });
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(`<title>${via}</title><h1 id="route">${via}</h1>`);
  });
  const sitePort = await listen(site);
  const stun = dgram.createSocket('udp4');
  stun.bind(0, '127.0.0.1');
  await once(stun, 'listening');
  const stunPort = stun.address().port;
  const listenerReady = once(stun, 'message');
  stun.send(Buffer.from('loopback control'), stunPort, '127.0.0.1');
  await listenerReady;
  let stunPackets = 0;
  stun.on('message', () => { stunPackets += 1; });

  function newProxy() {
    return net.createServer(socket => {
      proxySockets.add(socket);
      socket.on('close', () => proxySockets.delete(socket));
      socket.on('error', () => {});
      let buffer = Buffer.alloc(0);
      let greeting = true;
      function receive(chunk) {
        buffer = Buffer.concat([buffer, chunk]);
        if (greeting) {
          if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
          if (buffer[0] !== 5 || !buffer.subarray(2, 2 + buffer[1]).includes(0)) return socket.destroy();
          buffer = buffer.subarray(2 + buffer[1]);
          socket.write(Buffer.from([5, 0]));
          greeting = false;
        }
        if (buffer.length < 5) return;
        const addressEnd = buffer[3] === 1 ? 8 : buffer[3] === 3 ? 5 + buffer[4] : 0;
        if (addressEnd && buffer.length < addressEnd + 2) return;
        const host = buffer[3] === 1 ? [...buffer.subarray(4, 8)].join('.') : buffer.subarray(5, addressEnd).toString();
        proxyRequests.push({ host, port: addressEnd ? buffer.readUInt16BE(addressEnd) : null, command: buffer[1] });
        if (buffer[0] !== 5 || buffer[1] !== 1 || !addressEnd ||
            host !== 'vpn-browser.test' || buffer.readUInt16BE(addressEnd) !== sitePort) {
          socket.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]));
          return;
        }
        socket.pause();
        socket.off('data', receive);
        const upstream = net.connect(sitePort, '127.0.0.1', () => {
          const port = upstream.localPort;
          upstreamPorts.add(port);
          upstream.on('close', () => upstreamPorts.delete(port));
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (buffer.length > addressEnd + 2) upstream.write(buffer.subarray(addressEnd + 2));
          socket.pipe(upstream).pipe(socket);
          socket.resume();
        });
        upstream.on('error', () => socket.destroy());
        socket.on('close', () => upstream.destroy());
      }
      socket.on('data', receive);
    });
  }

  let proxy = newProxy();
  socksPort = await listen(proxy);
  const dashboard = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === `/app/login/${dashboardCode}`) {
      dashboardPages.push('login');
      assert.equal(req.headers['x-local-token'], undefined);
      res.writeHead(303, { Location: '/app/', 'Set-Cookie': 'test-session=ok; Path=/; HttpOnly; SameSite=Strict' }).end();
      return;
    }
    if (req.method === 'GET' && req.url === '/app/') {
      dashboardPages.push('dashboard');
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        `<title>Provider fixture</title><script>
           setTimeout(() => { location.href = "http://127.0.0.1:${sitePort}/dashboard-cross-origin"; }, 50);
           setTimeout(() => fetch('/app/still-here'), 200);
         </script>`,
      );
      return;
    }
    if (req.method === 'GET' && req.url === '/app/still-here') {
      dashboardPages.push('same-origin');
      dashboardSession = req.headers.cookie === 'test-session=ok';
      res.writeHead(204).end();
      return;
    }
    if (req.headers['x-local-token'] !== token) { res.writeHead(403).end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/status') {
      res.end(JSON.stringify({ data_dir: companionDir, system_proxy: systemProxy, selection: selectedCountry,
        state: { phase: running ? 'running' : 'off' }, accounts: { total: accountCount },
        proxy: running ? { listen: `127.0.0.1:${socksPort}`, login_required: false } : null }));
    } else if (req.method === 'GET' && req.url === '/api/routing') {
      res.end(JSON.stringify({ enabled: routing, active: routing }));
    } else if (req.method === 'GET' && req.url === '/api/locations') {
      res.end(JSON.stringify({ locations: [{ code: 'DE', name: 'Germany' }, { code: 'US', name: 'United States' }] }));
    } else if (req.method === 'POST' && req.url === '/api/location') {
      locationUpdates += 1;
      selectedCountry = JSON.parse(Buffer.concat(chunks).toString()).country;
      res.end(JSON.stringify({ saved: true }));
    } else if (req.method === 'GET' && req.url === '/api/settings') {
      res.end(JSON.stringify({ config: { routing: { enabled: routing } } }));
    } else if (req.method === 'PUT' && req.url === '/api/settings') {
      policyUpdates += 1;
      routing = JSON.parse(Buffer.concat(chunks).toString()).config.routing.enabled;
      res.end(JSON.stringify({ saved: true }));
    } else if (req.method === 'POST' && req.url === '/api/session/link') {
      res.end(JSON.stringify({ path: `/app/login/${dashboardCode}` }));
    } else if (req.method === 'POST' && req.url === '/api/power') {
      powerRequests += 1;
      running = JSON.parse(Buffer.concat(chunks).toString()).on === true;
      res.end(JSON.stringify({ on: running }));
    } else if (req.method === 'POST' && req.url === '/api/test') {
      tunnelTests += 1;
      res.end(JSON.stringify({ ok: testOK }));
    } else {
      res.writeHead(404).end();
    }
  });
  const dashboardPort = await listen(dashboard);
  t.after(async () => {
    await app.stop();
    stun.close();
    for (const socket of proxySockets) socket.destroy();
    dashboard.closeAllConnections();
    site.closeAllConnections();
    await Promise.all([close(site), close(dashboard), proxy.listening ? close(proxy) : undefined]);
  });

  await app.launch({ envOverrides: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '' } });
  companionDir = path.join(app.dataRoot, 'vpn', 'provider');
  mkdirSync(companionDir, { recursive: true });
  writeFileSync(path.join(companionDir, 'config.json'), JSON.stringify({
    dashboard: { listen: `127.0.0.1:${dashboardPort}` }, proxy: { listen: `127.0.0.1:${socksPort}` },
  }));
  writeFileSync(path.join(companionDir, 'local-api.token'), token);
  const page = app.chromePage();
  await page.waitForSelector('.commandbar__input');
  await page.getByRole('button', { name: 'HayDevVPN', exact: true }).click();
  const panel = page.getByRole('region', { name: 'HayDevVPN' });
  const status = panel.getByTestId('arman-vpn-state');
  const connect = panel.getByRole('button', { name: 'Connect', exact: true });
  const invoke = (name, args = {}) => page.evaluate(([command, input]) => window.__TAURI_INTERNALS__.invoke(command, input), [name, args]);
  const rejectedCode = (name, args = {}) => page.evaluate(async ([command, input]) => {
    try { await window.__TAURI_INTERNALS__.invoke(command, input); return 'unexpected-success'; }
    catch (error) { return error.code; }
  }, [name, args]);
  const tabs = () => invoke('browser_tabs_list');
  const state = value => status.and(page.locator(`[data-state="${value}"]`)).waitFor({ timeout: 12_000 });
  const url = (name, host = 'vpn-browser.test') => `http://${host}:${sitePort}/${name}`;
  const loaded = (tabId, expected) => poll(async () => {
    try {
      return await invoke('browser_evaluate', { req: { tabId, expression: `document.querySelector('#route')?.textContent === ${JSON.stringify(expected)}` } }) === true;
    } catch { return false; }
  }, `tab ${tabId} did not show the ${expected} route`);
  async function openProtected(name) {
    await panel.getByRole('textbox', { name: 'Site address', exact: true }).fill(url(name));
    await panel.getByRole('button', { name: 'Open VPN tab' }).press('Enter');
    const tab = await poll(async () => (await tabs()).find(tab => tab.profile === 'arman-vpn' && tab.pendingUrl === url(name)), 'VPN tab was not created');
    assert.equal(tab.isIncognito, true);
    assert.match(tab.egress, /^socks5:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(Number(new URL(tab.egress).port), socksPort);
    try { await loaded(tab.id, 'socks'); }
    catch (error) {
      const latest = (await tabs()).find(item => item.id === tab.id);
      const dom = await invoke('browser_evaluate', { req: { tabId: tab.id, expression: 'document.title + " " + document.body?.innerText?.slice(0, 300)' } }).catch(e => e.code);
      throw new Error(JSON.stringify({ message: error.message, tab: latest, dom, requests, proxyRequests }));
    }
    assert.deepEqual(requests.filter(req => req.url === `/${name}`), [{ url: `/${name}`, via: 'socks' }]);
    return tab;
  }
  async function disconnect(tab) {
    await panel.getByRole('button', { name: 'Disconnect VPN', exact: true }).click();
    await state('off');
    assert.ok((await tabs()).every(tab => tab.profile !== 'arman-vpn'));
    const port = Number(new URL(tab.egress).port);
    const socket = net.connect(port, '127.0.0.1');
    try { await assert.rejects(once(socket, 'connect'), { code: 'ECONNREFUSED' }); }
    finally { socket.destroy(); }
  }
  async function rejectNavigation(id, target) {
    await invoke('browser_navigate', { req: { tabId: id, url: target } });
    await poll(async () => {
      const tab = (await tabs()).find(tab => tab.id === id);
      return tab?.pendingUrl === target && tab.loadState === 'error';
    }, `VPN tab did not fail closed for ${target}`);
    assert.ok(requests.every(req => req.url !== new URL(target).pathname), JSON.stringify(requests));
  }

  await state('off');
  await panel.getByRole('button', { name: 'Sign in to Mozilla', exact: true }).waitFor();
  assert.equal(await panel.getByLabel('Provider data folder').count(), 0);
  await panel.getByRole('combobox', { name: 'Country', exact: true }).selectOption('DE');
  await poll(() => selectedCountry === 'DE', 'Country was not saved');
  await page.waitForFunction(() => !document.querySelector('.panel--vpn select').disabled);
  assert.equal(locationUpdates, 1);
  assert.equal(await rejectedCode('arman_vpn_set_location', { country: 'ZZ' }), 'ARMAN_VPN_LOCATION');
  assert.equal(locationUpdates, 1);
  const saved = JSON.parse(readFileSync(path.join(app.dataRoot, 'haydev-vpn.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved), ['dataDir']);
  assert.ok(saved.dataDir.endsWith(companionDir));
  assert.equal(await rejectedCode('arman_vpn_connect'), 'ARMAN_VPN_ACCOUNT_REQUIRED');
  assert.equal(powerRequests, 0);
  await panel.getByRole('button', { name: 'Sign in to Mozilla', exact: true }).press('Enter');
  await poll(() => dashboardSession, () => `provider dashboard session was not verified: ${dashboardPages.join(', ')}`);
  assert.equal(requests.some(req => req.url === '/dashboard-cross-origin'), false);
  accountCount = 1;
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'HayDevVPN', exact: true }).click();
  await state('off');
  systemProxy = 'set';
  await connect.click();
  await panel.getByRole('alert').filter({ hasText: 'system network' }).waitFor();
  assert.equal(powerRequests, 0);
  assert.equal(tunnelTests, 0);
  systemProxy = 'clear';
  assert.equal(await rejectedCode('arman_vpn_connect'), 'ARMAN_VPN_ROUTING_POLICY');
  assert.equal(policyUpdates, 0);
  assert.equal(routing, true);
  assert.equal(powerRequests, 0);
  routing = false;
  await connect.click();
  await panel.getByRole('alert').filter({ hasText: 'Connection check failed' }).waitFor();
  assert.equal(policyUpdates, 0);
  assert.equal(routing, false);
  assert.equal(powerRequests, 1);
  assert.equal(tunnelTests, 1);
  testOK = true;

  const direct = await invoke('browser_tabs_open', { req: { url: url('ordinary', '127.0.0.1'), activate: false } });
  await loaded(direct, 'direct');
  await connect.click();
  await state('ready');
  const first = await openProtected('first');
  const evaluateProtected = expression => invoke('browser_evaluate', { req: { tabId: first.id, expression } });
  await evaluateProtected('(' + function probeStun(port) {
    const state = window.__qaStun = { done: false, mainBlocked: false, childBlocked: false };
    const peers = [];
    function tryStun(scope) {
      if (typeof scope?.RTCPeerConnection !== 'function') return;
      const peer = new scope.RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:' + port }] });
      peers.push(peer);
      peer.createDataChannel('loopback');
      peer.createOffer().then(offer => peer.setLocalDescription(offer)).catch(() => {});
    }
    state.mainBlocked = typeof window.RTCPeerConnection === 'undefined' && typeof window.WebTransport === 'undefined';
    tryStun(window);
    const frame = document.createElement('iframe');
    frame.onload = () => {
      state.childBlocked = typeof frame.contentWindow.RTCPeerConnection === 'undefined';
      tryStun(frame.contentWindow);
    };
    frame.srcdoc = '<!doctype html><title>STUN fixture</title>';
    document.body.append(frame);
    tryStun(frame.contentWindow);
    setTimeout(() => { for (const peer of peers) peer.close(); state.done = true; }, 3000);
    return true;
  }.toString() + ')(' + stunPort + ')');
  await poll(async () => (await evaluateProtected('window.__qaStun')).done, 'STUN probe did not settle');
  const stunResult = await evaluateProtected('window.__qaStun');
  assert.equal(stunPackets, 0, 'The protected tab sent direct UDP packets');
  assert.equal(stunResult.mainBlocked, true);
  assert.equal(stunResult.childBlocked, true);
  console.log(JSON.stringify({ gate: 'protected WebView2 WebRTC', stunPackets, childFrameBlocked: true }));
  await rejectNavigation(first.id, url('private-destination', '127.0.0.1'));
  running = false;
  for (const socket of proxySockets) socket.destroy();
  await close(proxy);
  await state('blocked');
  await rejectNavigation(first.id, url('proxy-outage'));
  const outageRequests = requests.filter(req => req.url === '/proxy-outage').length;

  proxy = newProxy();
  await listen(proxy, socksPort);
  running = true;
  await state('ready');
  const restored = await openProtected('restored');
  await disconnect(restored);

  await connect.click();
  await state('ready');
  const second = await openProtected('second-cycle');
  await disconnect(second);
  assert.equal(tunnelTests, 3);
  assert.equal((await tabs()).find(tab => tab.id === direct)?.egress, 'direct');
  // WebView2 can retry the failed navigation after recovery. Any retry must
  // take the SOCKS route too, and the private destination stays forbidden.
  assert.ok(requests.every(req => req.url !== '/private-destination'));
  assert.ok(requests.filter(req => req.url === '/proxy-outage').every(req => req.via === 'socks'));
  writeFileSync(path.join(app.evidenceDir, 'arman-vpn-loop.json'), JSON.stringify({
    companion: 'local fixture', realWebView2: true, realProviderUsed: false,
    savedSettings: true, accountDashboardOpened: true, dashboardCrossOriginBlocked: true,
    startedProxyFromBrowser: true,
    automaticSetup: true, countrySelected: selectedCountry, locationUpdates,
    systemProxyTakeoverRejected: true, browserRoutingConfigured: true,
    failedTunnelRejected: true, privateDestinationRejected: true,
    requests, outageRequests, directFallback: false, cycles: 2, relayPortsClosed: true,
  }, null, 2));
});

const upstreamCore = process.env.HAYDEV_E2E_ARMAN_CORE;
test('HayDevVPN prepares its own release core, data folder and countries without path settings', {
  timeout: 120_000, skip: process.env.HAYDEV_E2E_VPN_MANAGED !== '1',
}, async t => {
  const app = new AppHandle();
  t.after(() => app.stop({ graceful: true }));
  await app.launch({ envOverrides: { HAYDEV_QA_VPN_CORE: '1', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '' } });
  const page = app.chromePage();
  await page.getByRole('button', { name: 'HayDevVPN', exact: true }).click();
  const panel = page.getByRole('region', { name: 'HayDevVPN', exact: true });
  await panel.getByRole('button', { name: 'Sign in to Mozilla', exact: true }).waitFor({ timeout: 60_000 });
  const stored = JSON.parse(readFileSync(path.join(app.dataRoot, 'haydev-vpn.json'), 'utf8'));
  const normalDir = stored.dataDir.startsWith('\\\\?\\') ? stored.dataDir.slice(4) : stored.dataDir;
  assert.ok(normalDir.toLowerCase().startsWith((app.dataRoot + path.sep).toLowerCase()));
  const config = JSON.parse(readFileSync(path.join(stored.dataDir, 'config.json'), 'utf8'));
  assert.match(config.dashboard.listen, /^127\.0\.0\.1:\d+$/);
  assert.match(config.proxy.listen, /^127\.0\.0\.1:\d+$/);
  assert.equal(config.routing.enabled, false);
  assert.equal(config.system_proxy.mode, 'clear');
  assert.equal(await panel.getByLabel('Provider data folder').count(), 0);
  const countries = await panel.getByRole('combobox', { name: 'Country', exact: true }).locator('option').allTextContents();
  assert.ok(countries.length >= 2);
  const countryCodes = await panel.getByRole('combobox', { name: 'Country', exact: true }).locator('option').evaluateAll(options => options.map(option => option.value).filter(value => /^[A-Z]{2}$/.test(value)));
  let savedCountry = null;
  if (countryCodes.length) {
    savedCountry = countryCodes.includes('DE') ? 'DE' : countryCodes[0];
    await panel.getByRole('combobox', { name: 'Country', exact: true }).selectOption(savedCountry);
    await poll(() => JSON.parse(readFileSync(path.join(stored.dataDir, 'config.json'), 'utf8')).proxy.country === savedCountry, 'Country was not persisted by the release core');
  }
  const result = await page.evaluate(async () => {
    try { await window.__TAURI_INTERNALS__.invoke('arman_vpn_connect'); return 'unexpected'; }
    catch (error) { return error.code; }
  });
  assert.equal(result, 'ARMAN_VPN_ACCOUNT_REQUIRED');
  await page.screenshot({ path: path.join(app.evidenceDir, 'vpn-automatic.png') });
  const port = Number(config.dashboard.listen.split(':').at(-1));
  await app.stop({ graceful: true });
  await poll(async () => {
    const socket = net.connect(port, '127.0.0.1');
    try { await once(socket, 'connect'); return false; }
    catch (error) { return error.code === 'ECONNREFUSED'; }
    finally { socket.destroy(); }
  }, 'Managed core did not stop with the browser');
  writeFileSync(path.join(app.evidenceDir, 'vpn-automatic.json'), JSON.stringify({
    publishedReleaseCore: true, realWebView2: true, automaticDataFolder: true,
    privateLocalApi: true, browserOnlyRouting: true, coreStoppedWithBrowser: true,
    countries, savedCountry, upstreamAccount: false, authenticatedTunnel: false, result,
  }, null, 2));
});

test('Arman VPN upstream release core: empty profile cannot activate the browser route', {
  timeout: 120_000,
  skip: !upstreamCore,
}, async t => {
  const app = new AppHandle();
  let core;
  let dashboardAccepted = false;
  t.after(async () => {
    if (core?.exitCode === null) {
      const exited = once(core, 'exit');
      core.kill();
      await exited;
    }
    await app.stop();
  });
  await app.launch({ envOverrides: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '' } });
  const dataDir = path.join(app.dataRoot, 'arman-real-core-empty');
  mkdirSync(dataDir);
  const dashboardReservation = net.createServer();
  const proxyReservation = net.createServer();
  const dashboardPort = await listen(dashboardReservation);
  const proxyPort = await listen(proxyReservation);
  await Promise.all([close(dashboardReservation), close(proxyReservation)]);
  writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    dashboard: { enabled: true, listen: `127.0.0.1:${dashboardPort}` },
    proxy: { listen: `127.0.0.1:${proxyPort}` }, system_proxy: { mode: 'clear' },
    network: { api_relay_enabled: false }, routing: { enabled: false },
  }));
  core = spawn(upstreamCore, ['-plain', '-data-dir', dataDir], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let logTail = '';
  core.stderr.on('data', chunk => {
    const output = logTail + chunk.toString();
    dashboardAccepted ||= output.includes('dashboard signed in with a link from the app');
    logTail = output.slice(-128);
  });
  await once(core, 'spawn');
  const deadline = Date.now() + 12_000;
  while (!existsSync(path.join(dataDir, 'local-api.token'))) {
    assert.equal(core.exitCode, null, 'upstream core exited during startup');
    assert.ok(Date.now() < deadline, 'upstream local API token was not created');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const page = app.chromePage();
  await page.waitForSelector('.commandbar__input');
  await page.evaluate(async dir => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    await invoke('arman_vpn_save_settings', { dataDir: dir });
    await invoke('arman_vpn_open_settings');
  }, dataDir);
  await poll(() => dashboardAccepted, 'released provider did not accept its one-time dashboard link');
  const result = await page.evaluate(async dir => {
    try { return await window.__TAURI_INTERNALS__.invoke('arman_vpn_connect', { dataDir: dir }); }
    catch (error) { return { code: error.code }; }
  }, dataDir);
  assert.deepEqual(result, { code: 'ARMAN_VPN_ACCOUNT_REQUIRED' });
  writeFileSync(path.join(app.evidenceDir, 'arman-vpn-real-core.json'), JSON.stringify({
    publishedReleaseCore: true, realWebView2: true, emptyProfile: true,
    authenticatedLocalApi: true, releasedDashboardOpened: true,
    upstreamAccount: false, browserRouteRejected: true,
    result,
  }, null, 2));
});
