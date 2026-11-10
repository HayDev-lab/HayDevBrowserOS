// Run against the local Arman VPN instance after the user has signed in.
// No account data or local API token is included in the evidence.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { AppHandle } from '../e2e/harness.mjs';

const dataDir = realpathSync(process.argv[2] ?? '');
const listen = JSON.parse(readFileSync(path.join(dataDir, 'config.json'), 'utf8')).dashboard?.listen;
const match = /^127\.0\.0\.1:(\d{1,5})$/.exec(listen ?? '');
assert.ok(match && Number(match[1]) > 0 && Number(match[1]) <= 65535, 'ARMAN_LOCAL_DASHBOARD_REQUIRED');
const apiPort = Number(match[1]);

function localApi(route, body) {
  const token = readFileSync(path.join(dataDir, 'local-api.token'), 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) throw Error('ARMAN_LOCAL_TOKEN_FORMAT');
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: apiPort, path: route,
      method: body ? 'POST' : 'GET', agent: false,
      headers: { 'X-Local-Token': token, ...(body && { 'Content-Type': 'application/json' }) },
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(Error(`ARMAN_API_HTTP_${response.statusCode}`));
        return;
      }
      let length = 0;
      const chunks = [];
      response.on('error', reject);
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 512 * 1024) request.destroy(Error('ARMAN_API_RESPONSE_LIMIT'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(Error('ARMAN_API_INVALID_JSON')); }
      });
    });
    request.setTimeout(4000, () => request.destroy(Error('ARMAN_API_TIMEOUT')));
    request.on('error', reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });
}

async function poll(check, timeout, code) {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw Error(code);
}

function portClosed(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', error => { socket.destroy(); resolve(error.code === 'ECONNREFUSED'); });
    socket.setTimeout(700, () => { socket.destroy(); resolve(false); });
  });
}

function requireProxyOnly(status, routing) {
  assert.equal(status.system_proxy, 'clear', 'ARMAN_PROXY_ONLY_REQUIRED');
  assert.ok(!routing.enabled && !routing.active, 'ARMAN_ROUTING_RULES_MUST_BE_OFF');
  assert.equal(realpathSync(status.data_dir).toLowerCase(), dataDir.toLowerCase(), 'ARMAN_DATA_FOLDER_MISMATCH');
}

const app = new AppHandle();
const evidence = { actualBrowser: 'WebView2', cycles: [], passed: false };
let startedCompanion = false;
let invoke;
try {
  const initial = await localApi('/api/status');
  requireProxyOnly(initial, await localApi('/api/routing'));
  evidence.coreVersion = initial.version;
  if (!initial.active_account && !(initial.accounts?.ready > 0)) throw Error('ARMAN_SIGN_IN_REQUIRED');
  if (initial.state?.phase === 'off') {
    startedCompanion = true;
    await localApi('/api/power', { on: true });
  }
  await poll(async () => {
    const status = await localApi('/api/status');
    return status.state?.phase === 'running' && status.proxy;
  }, 65_000, 'ARMAN_PROXY_DID_NOT_START');

  await app.launch({ envOverrides: { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '', GEMINI_API_KEY: '', OPENAI_API_KEY: '', OPENROUTER_API_KEY: '' } });
  const shell = app.chromePage();
  await shell.waitForSelector('.commandbar__input');
  invoke = (command, args = {}) => shell.evaluate(([name, input]) => window.__TAURI_INTERNALS__.invoke(name, input), [command, args]);
  const initialTabs = (await invoke('browser_tabs_list')).filter(tab => tab.profile !== 'arman-vpn');
  const targetConnections = async authority => ((await localApi('/api/connections')).connections ?? []).filter(connection => connection.target === authority);

  for (const host of ['example.com', 'example.org']) {
    const target = `https://${host}/?arman-browser-check=${randomUUID()}`;
    const authority = `${host}:443`;
    const existingIds = new Set((await targetConnections(authority)).map(row => row.id));
    assert.equal((await invoke('arman_vpn_connect', { dataDir })).state, 'ready');
    const tabId = await invoke('arman_vpn_open_tab', { url: target });
    const tab = (await invoke('browser_tabs_list')).find(row => row.id === tabId);
    assert.ok(tab?.isIncognito && tab.profile === 'arman-vpn' && /^socks5:\/\/127\.0\.0\.1:\d+$/.test(tab.egress), 'ARMAN_TAB_ROUTE_NOT_BOUND');
    await poll(async () => {
      try {
        return (await invoke('browser_evaluate', { req: { tabId,
          expression: `location.hostname === ${JSON.stringify(host)} && document.title === 'Example Domain' && Boolean(document.querySelector('h1')?.textContent.includes('Example Domain'))`,
        } })) === true;
      } catch { return false; }
    }, 20_000, `ARMAN_WEBVIEW_HTTPS_FAILED_${host}`);
    const flow = await poll(async () => (await targetConnections(authority)).find(row =>
      !existingIds.has(row.id) && row.route === 'vpn' && row.inbound === 'socks5' && row.up > 0 && row.down > 0
    ), 8_000, `ARMAN_MOZILLA_FLOW_NOT_CONFIRMED_${host}`);
    assert.equal((await invoke('arman_vpn_disconnect')).state, 'off');
    const tabsAfter = await invoke('browser_tabs_list');
    assert.ok(tabsAfter.every(row => row.profile !== 'arman-vpn'));
    assert.ok(initialTabs.every(row => tabsAfter.some(item => item.id === row.id)));
    assert.ok(await portClosed(Number(new URL(tab.egress).port)), 'ARMAN_BROWSER_RELAY_STILL_OPEN');
    evidence.cycles.push({ host, httpsPageLoaded: true, inbound: flow.inbound, route: flow.route,
      transport: flow.transport, bytesSent: flow.up, bytesReceived: flow.down, disconnected: true, relayClosed: true });
    console.log(JSON.stringify(evidence.cycles.at(-1)));
  }
  evidence.passed = true;
} catch (error) {
  evidence.error = typeof error?.code === 'string' ? error.code : String(error?.message ?? 'ARMAN_LIVE_TEST_FAILED');
  console.error(JSON.stringify(evidence));
  process.exitCode = 1;
} finally {
  if (invoke) await invoke('arman_vpn_disconnect').catch(() => {});
  await app.stop();
  if (startedCompanion) {
    await localApi('/api/power', { on: false });
    evidence.companionRestored = Boolean(await poll(async () => (await localApi('/api/status')).state?.phase === 'off', 8000, 'ARMAN_POWER_RESTORE_FAILED'));
  }
  if (app.evidenceDir) {
    const file = path.join(app.evidenceDir, 'arman-vpn-live.json');
    writeFileSync(file, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ evidence: file, passed: evidence.passed }));
  }
}
