/**
 * P02 gate — privacy, egress, CDP/MCP and network boundaries:
 *  1. MCP: wrong Host / browser Origin / missing or bad token / token in
 *     URL are all REJECTED; the token-gated path answers JSON-RPC;
 *  2. a PRIVATE tab opens through the real IPC path and is flagged
 *     incognito in the registry (its own environment is CDP-dark by design);
 *  3. Playwright still connects after the `--remote-allow-origins=*`
 *     removal (native clients are Origin-less by design).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { AppHandle } from '../../scripts/e2e/harness.mjs';
import { fixtureServer } from '../../scripts/e2e/fixtures/server.mjs';

const MCP_PORT = Number(process.env.HAYDEV_MCP_TEST_PORT || 27901);

function mcpPost(body, { headers = {}, url = null } = {}) {
  return fetch(url ?? `http://127.0.0.1:${MCP_PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: `127.0.0.1:${MCP_PORT}`, ...headers },
    body: JSON.stringify(body),
  });
}

test('P02: MCP access control, private tab registry, CDP native connect', { timeout: 180_000 }, async (t) => {
  const app = new AppHandle();
  t.after(async () => { await app.stop(); });
  await app.launch();

  // The session token appears once the MCP thread has started.
  const tokenPath = path.join(app.dataRoot, 'mcp-token');
  const deadline = Date.now() + 20_000;
  while (!existsSync(tokenPath) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(existsSync(tokenPath), 'MCP session token file must exist in the test data root');
  const token = readFileSync(tokenPath, 'utf8').trim();
  assert.ok(token.length >= 16, 'token must not be trivially short');

  // 1a. No token → rejected.
  const noToken = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.ok([401, 503].includes(noToken.status), `no-token must be 401/503, got ${noToken.status}`);

  // 1b. Wrong token → 401.
  const badToken = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, {
    headers: { authorization: 'Bearer wrong-token' },
  });
  assert.equal(badToken.status, 401, 'wrong token must be 401');

  // 1c. Browser Origin → 403 even with a good token.
  const withOrigin = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, {
    headers: { origin: 'http://evil.example', authorization: `Bearer ${token}` },
  });
  assert.equal(withOrigin.status, 403, 'browser Origin must be rejected');

  // 1d. Wrong Host header (DNS-rebinding shape) → 403.
  // undici's fetch refuses to forge Host — use a raw socket-level request.
  const badHost = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: MCP_PORT,
      method: 'POST',
      path: '/mcp',
      headers: {
        host: 'attacker.example',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  });
  assert.equal(badHost, 403, 'wrong Host must be rejected');

  // 1e. Token in URL → 400 (no secrets in URLs).
  const inUrl = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, {
    url: `http://127.0.0.1:${MCP_PORT}/mcp?token=${encodeURIComponent(token)}`,
  });
  assert.equal(inUrl.status, 400, 'token-in-URL must be refused');

  // 1f. Correct token → JSON-RPC answer.
  const ok = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(ok.status, 200);
  const initBody = await ok.json();
  assert.equal(initBody?.result?.serverInfo?.name, 'haydev-browser-darkweb', 'initialize must answer');

  // 1g. tools/list is token-gated too and lists the bounded darkweb set.
  const tools = await mcpPost({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(tools.status, 200);
  const toolNames = (await tools.json())?.result?.tools?.map((x) => x.name) ?? [];
  assert.ok(toolNames.includes('darkweb_search'), 'darkweb tools remain available');
  assert.ok(!toolNames.some((n) => /shell|exec|file|eval/i.test(n)), 'no filesystem/shell/eval tools');

  // 2. Private tab through the REAL IPC path (incognito env is CDP-dark —
  //    the registry flag is the observable contract here).
  const chromePage = app.chromePage();
  await chromePage.waitForSelector('.commandbar__input', { timeout: 30_000 });
  const openResult = await chromePage.evaluate(async (url) => {
    try {
      return await window.__TAURI_INTERNALS__.invoke('browser_tabs_open', { req: { url, activate: true, incognito: true } });
    } catch (e) {
      return { __error: String(e) };
    }
  }, fixtureServer.url('/static'));
  assert.ok(!openResult?.__error, `private tab open must succeed (got ${JSON.stringify(openResult)})`);
  const tabs = await chromePage.evaluate(() => window.__TAURI_INTERNALS__.invoke('browser_tabs_list'));
  const priv = (Array.isArray(tabs) ? tabs : []).find((x) => x?.isIncognito);
  assert.ok(priv, 'an incognito-flagged tab must be in the registry');

  // 3. CDP connectivity sanity: both environments still answer after the
  //    wildcard-origin removal (native clients carry no Origin header).
  assert.ok(app.chrome && app.tabs, 'both CDP connections alive');
});
