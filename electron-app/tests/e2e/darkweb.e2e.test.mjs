import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import test from 'node:test';
import { AppHandle } from '../../scripts/e2e/harness.mjs';

const onionHost = 'a'.repeat(56) + '.onion';
const onionPage = 'http://' + onionHost + '/welcome';

async function createOnionFixture() {
  const clients = new Set();
  const requests = [];
  const server = net.createServer(socket => {
    clients.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => clients.delete(socket));
    let state = 'greeting';
    let pending = Buffer.alloc(0);
    let host;
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (state === 'greeting') {
        if (pending.length < 2 || pending.length < 2 + pending[1]) return;
        pending = pending.subarray(2 + pending[1]);
        socket.write(Buffer.from([5, 0]));
        state = 'connect';
      }
      if (state === 'connect') {
        if (pending.length < 5) return;
        if (pending[3] !== 3) {
          socket.destroy();
          return;
        }
        const end = 5 + pending[4];
        if (pending.length < end + 2) return;
        host = pending.subarray(5, end).toString();
        pending = pending.subarray(end + 2);
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        state = 'http';
      }
      if (state !== 'http' || !pending.includes('\r\n\r\n')) return;
      state = 'done';
      const path = pending.toString().split(' ')[1];
      requests.push({ host, path });
      if (path === '/hold') return;
      const status = path === '/missing' ? '404 Not Found' : '200 OK';
      const download = path === '/download';
      const headers = download
        ? 'Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="haydev-synthetic.txt"\r\n'
        : 'Content-Type: text/html; charset=utf-8\r\n';
      const html = '<html><head><title>Fixture onion page</title></head><body>'
        + '<a id="download" href="/download">Download fixture</a>Армения Երևան '
        + '<script>document.documentElement.dataset.proof = "page-script-ran"; /* should-not-index */</script>'
        + '</body></html>';
      const body = Buffer.from(download ? 'synthetic quarantine proof'
        : host === onionHost ? html : '<a href="' + onionPage + '">Synthetic onion result</a>');
      socket.end(Buffer.concat([
        Buffer.from('HTTP/1.1 ' + status + '\r\n' + headers
          + 'Content-Length: ' + body.length + '\r\nConnection: close\r\n\r\n'),
        body,
      ]));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    requests,
    release() {
      for (const client of clients) client.destroy();
    },
    async close() {
      this.release();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function waitUntil(read, accept, message) {
  const deadline = Date.now() + 6000;
  let value;
  do {
    value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 120));
  } while (Date.now() < deadline);
  assert.fail(message + ': ' + JSON.stringify(value));
}

test('DarkWeb search, index settings, Tor refusal and crawler lifecycle', { timeout: 70_000 }, async t => {
  const app = new AppHandle();
  const fixture = await createOnionFixture();
  t.after(async () => {
    await app.stop();
    await fixture.close();
  });
  const envOverrides = {
    HAYDEV_NO_ENGINES: '0',
    PAB_TOR_MODE: 'external',
    PAB_TOR_SOCKS_PORT: '1',
    HTTPS_PROXY: 'http://127.0.0.1:1',
  };
  async function openDarkWeb(dataRoot) {
    await app.launch({ dataRoot, envOverrides });
    const chrome = app.chromePage();
    await chrome.waitForSelector('.commandbar__input');
    await chrome.evaluate(() => window.__TAURI_INTERNALS__.invoke('browser_tabs_open',
      { req: { url: 'pab://darkweb', activate: true } }));
    const page = await app.waitTabPage(/pab\.darkweb|pab\.localhost\/darkweb/);
    await page.waitForSelector('#tor-pill');
    return page;
  }

  let page = await openDarkWeb();
  const api = (url, body) => page.evaluate(async ({ url, body }) => {
    const response = await fetch('/api/' + url, body === undefined ? undefined : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, { url, body });

  assert.equal((await api('settings', {
    tor: { socksHost: '127.0.0.1', socksPort: 1, spawnIfAvailable: false },
    search: { availability: { enabled: false } },
  })).status, 200);
  await t.test('search requires Tor before contacting either upstream', async () => {
    const response = await api('search', { query: 'synthetic network guard', providers: ['ahmia'] });
    assert.equal(response.body.error, 'TOR_UNAVAILABLE',
      'An upstream job started without Tor: ' + JSON.stringify(response));
  });

  assert.equal((await api('settings', {
    tor: { socksPort: fixture.port },
    crawler: { maxDepth: 2, maxPages: 8 },
    storeLocalIndex: true,
  })).status, 200);

  await t.test('UI indexes real multilingual page text and reports disabled storage', async () => {
    const settings = (await api('settings')).body;
    assert.equal(settings.storeLocalIndex, true);
    assert.deepEqual(settings.crawler, { maxDepth: 2, maxPages: 8 });

    await page.locator('#prov-checks input').last().waitFor();
    await page.locator('#prov-checks input').first().uncheck();
    await page.locator('#input').fill('synthetic onion result');
    await page.locator('#go').click();
    await page.getByRole('button', { name: 'Add to index', exact: true }).click();
    await waitUntil(() => api('index/search?q=' + encodeURIComponent('Երևան')),
      response => response.body.hits?.length === 1, 'Index did not store the actual page text');
    assert.ok(fixture.requests.some(request => request.host === onionHost && request.path === '/welcome'));

    assert.equal((await api('settings', { storeLocalIndex: false })).body.config.storeLocalIndex, false);
    const disabled = await api('index/add', { url: onionPage });
    assert.equal(disabled.body.error, 'INDEX_DISABLED');
    assert.equal((await api('settings', { storeLocalIndex: true })).status, 200);
  });

  await t.test('failed fetch and cancellation settle without writing late index entries', async () => {
    const missing = (await api('crawl', { url: 'http://' + onionHost + '/missing' })).body;
    assert.ok(missing.jobId);
    const failed = await waitUntil(() => api('crawl/' + missing.jobId),
      response => response.body.state === 'ERROR', 'Failed crawl remained active');
    assert.equal(failed.body.pagesFailed, 1);
    assert.equal(failed.body.docsAdded, 0);
    assert.equal(failed.body.maxPages, 8);

    const pending = (await api('crawl', { url: 'http://' + onionHost + '/hold' })).body;
    assert.ok(pending.jobId);
    await waitUntil(() => fixture.requests, requests => requests.some(request => request.path === '/hold'),
      'Crawler did not reach the SOCKS fixture');
    assert.equal((await api('crawl/' + pending.jobId + '/cancel', {})).body.ok, true);
    fixture.release();
    const cancelled = await waitUntil(() => api('crawl/' + pending.jobId),
      response => response.body.state === 'CANCELLED', 'Cancelled crawl did not drain');
    assert.equal(cancelled.body.docsAdded, 0);
  });

  await t.test('saved index and settings survive browser restart', async () => {
    const dataRoot = app.dataRoot;
    app.dataRootCreated = false;
    await app.stop();
    page = await openDarkWeb(dataRoot);
    app.dataRootCreated = true;
    assert.deepEqual((await api('settings')).body.crawler, { maxDepth: 2, maxPages: 8 });
    const hits = await api('index/search?q=' + encodeURIComponent('Երևան'));
    assert.equal(hits.body.hits.length, 1);
    assert.equal(hits.body.hits[0].url, onionPage);
    assert.equal((await api('index/search?q=should-not-index')).body.hits.length, 0);
  });

  console.log(JSON.stringify({ socksRequests: fixture.requests.map(request => ({
    target: request.host === onionHost ? 'fixture onion' : 'provider', path: request.path.split('?')[0],
  })) }));
});


test('Onion pages require Tor, disable website scripts and quarantine downloads', { timeout: 70_000 }, async t => {
  const app = new AppHandle();
  const fixture = await createOnionFixture();
  t.after(async () => { await app.stop(); await fixture.close(); });
  await app.launch({ envOverrides: {
    HAYDEV_NO_ENGINES: '0', PAB_TOR_MODE: 'external', PAB_TOR_SOCKS_PORT: '1',
  } });
  const chrome = app.chromePage();
  await chrome.waitForSelector('.commandbar__input');
  const invoke = (command, args) => chrome.evaluate(([command, args]) =>
    window.__TAURI_INTERNALS__.invoke(command, args), [command, args]);
  const controlTabId = await invoke('browser_tabs_open', { req: { url: 'pab://darkweb', activate: true } });
  const page = await app.waitTabPage(/pab\.darkweb|pab\.localhost\/darkweb/);
  const api = (route, body) => page.evaluate(async ({ route, body }) => {
    const response = await fetch('/api/' + route, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, { route, body });

  const port = { socksHost: '127.0.0.1', socksPort: 1, spawnIfAvailable: false };
  assert.equal((await api('settings', { tor: port })).status, 200);
  const errorCode = (command, req) => chrome.evaluate(([command, req]) =>
    window.__TAURI_INTERNALS__.invoke(command, { req }).then(() => null, error => error.code), [command, req]);
  assert.equal(await errorCode('browser_tabs_open', { url: onionPage, activate: true }), 'EGRESS_UNAVAILABLE');
  assert.equal(await errorCode('browser_navigate', { tabId: controlTabId, url: onionPage }), 'ONION_REQUIRES_TOR_TAB');

  assert.equal((await api('settings', { tor: { socksPort: fixture.port } })).status, 200);
  const outside = await api('preview', { url: 'https://example.com/' });
  assert.equal(outside.body.error, 'ONION_ONLY');
  const preview = await api('preview', { url: onionPage });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.title, 'Fixture onion page');
  assert.match(preview.body.html, /Երևան/);
  assert.doesNotMatch(preview.body.html, /<script|should-not-index/);

  const tabId = await invoke('browser_tabs_open', { req: { url: onionPage, activate: true } });
  const evalTab = expression => invoke('browser_evaluate', { req: { tabId, expression } });
  await waitUntil(() => evalTab('document.title === "Fixture onion page"').catch(() => false),
    Boolean, 'Onion WebView did not load');
  const tab = (await invoke('browser_tabs_list')).find(candidate => candidate.id === tabId);
  assert.equal(tab.isDarkWeb, true);
  assert.match(tab.egress, /^socks5:\/\/127\.0\.0\.1:/);
  assert.equal(await evalTab('document.documentElement.dataset.proof === "page-script-ran"'), false);

  assert.equal(await evalTab('(document.querySelector("#download").click(), true)'), true);
  const response = await waitUntil(() => api('downloads'),
    result => result.body.downloads?.some(item => item.complete), 'Onion download did not reach quarantine');
  const entry = response.body.downloads.find(item => item.complete);
  assert.equal(entry.state, 'QUARANTINED');
  assert.equal(entry.dangerous, false);
  const root = path.join(app.dataRoot, 'darkweb', 'quarantine');
  const savedName = readdirSync(root).find(name => name.startsWith(entry.id));
  assert.ok(savedName);
  const payload = readFileSync(path.join(root, savedName), 'utf8');
  assert.equal(payload, 'synthetic quarantine proof');
  assert.equal(entry.sizeBytes, Buffer.byteLength(payload));
  assert.equal((await api('downloads/' + entry.id + '/discard', {})).body.ok, true);
  assert.equal(readdirSync(root).includes(savedName), false);
  assert.equal((await api('downloads')).body.downloads.find(item => item.id === entry.id).state, 'DISCARDED');

  const initialTab = await app.waitTabPage(/pab\.newtab|pab\.localhost\/newtab/);
  const openResult = await initialTab.evaluate(async url => {
    const response = await fetch('/open?url=' + encodeURIComponent(url));
    return response.text();
  }, onionPage);
  assert.match(openResult, /Opened in an isolated Tor tab/);
  const routed = (await invoke('browser_tabs_list')).filter(candidate => candidate.isDarkWeb);
  assert.equal(routed.length, 2);

  console.log(JSON.stringify({ preview: 'sanitized', noTor: 'refused', pageScripts: 'blocked',
    onionDownload: 'quarantined', expectedBytes: true, discarded: true, inlineSearchOpen: 'Tor' }));
});
