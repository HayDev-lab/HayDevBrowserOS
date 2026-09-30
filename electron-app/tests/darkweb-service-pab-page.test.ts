/**
 * DarkWebService facade + pab://darkweb mini-API + tab flag + page builder.
 */
import { describe, it, expect } from 'vitest';
import { DarkWebService } from '../src/main/browser/darkweb/runtime/darkweb-service';
import { handleDarkWebPabRequest } from '../src/main/browser/darkweb/runtime/darkweb-pab-api';
import { validateDarkWebConfig } from '../src/main/browser/darkweb/pure/darkweb-config';
import { buildDarkWebPageHtml } from '../src/main/browser/darkweb/pure/darkweb-page';
import { TabManager } from '../src/main/browser/pure/tab-manager';
import { memoryStorage } from './_helpers';

function makeService(): DarkWebService {
  return new DarkWebService({
    userDataDir: '.',
    configStorage: memoryStorage(),
    indexStorage: memoryStorage(),
    historyStorage: memoryStorage(),
  });
}

describe('DarkWebService facade', () => {
  it('loads default config, lists providers, reports Tor offline honestly', async () => {
    const svc = makeService();
    await svc.loadConfig();
    expect(svc.getConfig().enabled).toBe(true);
    const ids = svc.providerStatuses().map((p) => p.id).sort();
    expect(ids).toEqual(['ahmia', 'tor66']);
    const status = await svc.uiStatus();
    expect(status.tor.state).not.toBe('READY'); // no Tor in the test env
  });

  it('persists settings patches', async () => {
    const svc = makeService();
    await svc.loadConfig();
    await svc.updateSettings({ crawler: { maxPages: 40 }, providers: { tor66: { enabled: false } } });
    expect(svc.getConfig().crawler.maxPages).toBe(40);
    expect(svc.getConfig().providers.tor66?.enabled).toBe(false);
  });

  it('exposes an MCP port satisfying the structural surface', async () => {
    const svc = makeService();
    await svc.loadConfig();
    const port = svc.mcpPort();
    expect(Array.isArray(port.providers())).toBe(true);
    expect((await port.status())).toHaveProperty('tor');
    expect(port.crawlStatus('nope')).toBeNull();
  });

  it('fetchPage refuses non-onion URLs (fail-closed through the facade)', async () => {
    const svc = makeService();
    await svc.loadConfig();
    await expect(svc.fetchPage('https://example.com/')).rejects.toMatchObject({ code: 'not_onion_host' });
    await expect(svc.fetchPage('http://127.0.0.1/')).rejects.toMatchObject({ code: 'private_or_local_target' });
  });
});

describe('pab://darkweb mini-API', () => {
  function req(method: string, path: string, body?: unknown): Request {
    return new Request(`pab://darkweb${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    });
  }

  it('serves the page HTML at /', async () => {
    const svc = makeService();
    const res = await handleDarkWebPabRequest(req('GET', '/'), {
      service: svc,
      openDarkWebTab: () => true,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('exposes status/settings/history endpoints', async () => {
    const svc = makeService();
    await svc.loadConfig();
    const status = await (await handleDarkWebPabRequest(req('GET', '/api/status'), { service: svc, openDarkWebTab: () => true })).json();
    expect(status).toHaveProperty('tor');
    expect(status).toHaveProperty('providers');

    const settings = await (await handleDarkWebPabRequest(req('GET', '/api/settings'), { service: svc, openDarkWebTab: () => true })).json();
    expect(settings).toHaveProperty('crawler');

    const patched = await handleDarkWebPabRequest(req('POST', '/api/settings', { enabled: false }), { service: svc, openDarkWebTab: () => true });
    expect(patched.status).toBe(200);
    expect(svc.getConfig().enabled).toBe(false);
  });

  it('routes search → poll → cancel lifecycle', async () => {
    const svc = makeService();
    await svc.loadConfig();
    const init = (await (await handleDarkWebPabRequest(req('POST', '/api/search', { query: 'q' }), { service: svc, openDarkWebTab: () => true })).json()) as { searchId: string };
    expect(init.searchId).toBeTruthy();
    const polled = (await (await handleDarkWebPabRequest(req('GET', `/api/search/${init.searchId}`), { service: svc, openDarkWebTab: () => true })).json()) as { state: string };
    expect(polled).toHaveProperty('state');
    const cancelled = (await (await handleDarkWebPabRequest(req('POST', `/api/search/${init.searchId}/cancel`), { service: svc, openDarkWebTab: () => true })).json()) as { ok: boolean };
    expect(cancelled.ok).toBe(true);
  });

  it('validates inputs: bad JSON → 400, unknown route → 404, /open with junk refused', async () => {
    const svc = makeService();
    const bad = await handleDarkWebPabRequest(new Request('pab://darkweb/api/search', { method: 'POST', body: '{oops', headers: { 'content-type': 'application/json' } }), { service: svc, openDarkWebTab: () => true });
    expect(bad.status).toBe(400);
    const missing = await handleDarkWebPabRequest(req('GET', '/api/nope'), { service: svc, openDarkWebTab: () => true });
    expect(missing.status).toBe(404);

    let opened = '';
    const refused = await handleDarkWebPabRequest(req('GET', `/open?url=${encodeURIComponent('https://example.com/')}`), {
      service: svc,
      openDarkWebTab: (u) => {
        opened = u;
        return false;
      },
    });
    expect(await refused.text()).toContain('not a valid .onion');
    expect(opened).toBe('https://example.com/'); // the guard still saw the URL
  });

  it('downloads surface works with a store', async () => {
    const svc = makeService();
    const store = {
      list: () => [{ id: 'd1', filename: 'a.exe', mimeType: 'application/x-msdownload', sizeBytes: 5, sourceUrl: 'http://x.onion/a.exe', receivedAt: 1, state: 'QUARANTINED' as const, dangerous: true }],
      save: async () => ({ ok: true }),
      discard: () => true,
    };
    const res = (await (await handleDarkWebPabRequest(req('GET', '/api/downloads'), { service: svc, openDarkWebTab: () => true, downloads: store })).json()) as { downloads: Array<{ dangerous: boolean }> };
    expect(res.downloads).toHaveLength(1);
    expect(res.downloads[0].dangerous).toBe(true);
    const saved = (await (await handleDarkWebPabRequest(req('POST', '/api/downloads/d1/save'), { service: svc, openDarkWebTab: () => true, downloads: store })).json()) as { ok: boolean };
    expect(saved.ok).toBe(true);
  });
});

describe('tab flag (spec §68)', () => {
  it('TabManager records isDarkWeb and normal tabs default to false', () => {
    const mgr = new TabManager();
    const dark = mgr.openTab({ url: 'http://x.onion/', darkweb: true });
    const normal = mgr.openTab({ url: 'https://example.com/' });
    expect(mgr.getTab(dark)?.isDarkWeb).toBe(true);
    expect(mgr.getTab(normal)?.isDarkWeb).toBe(false);
    expect(mgr.getTab(normal)?.isIncognito).toBe(false);
  });
});

describe('darkweb page builder', () => {
  it('renders the full UI skeleton with no external dependencies', () => {
    const html = buildDarkWebPageHtml();
    for (const marker of [
      'id="form"', 'id="input"', 'id="tor-pill"', 'id="results"',
      'id="settings-panel"', 'id="crawl-list"', 'id="downloads-list"',
      'id="preview-frame"', 'sandbox=""', 'Clear Dark Web search history',
      "fetch('/api/'", '/open?url=',
    ]) {
      expect(html).toContain(marker);
    }
    // The page must NOT embed any secrets or endpoints beyond same-origin.
    expect(html).not.toMatch(/socks5:\/\//);
  });

  it('sanity: config validator still rejects garbage passed by the page', () => {
    const r = validateDarkWebConfig({ tor: { socksPort: 'not-a-number' } });
    expect(r.config.tor.socksPort).toBe(9050);
  });
});
