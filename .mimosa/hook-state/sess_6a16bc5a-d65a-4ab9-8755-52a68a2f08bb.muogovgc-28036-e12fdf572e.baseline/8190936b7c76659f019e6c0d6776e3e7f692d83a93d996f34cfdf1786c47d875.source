/**
 * SearchService orchestrator (spec §7/§51/§52), crawler limits + cancel
 * (spec §22–§24), and the local index (spec §25–§27) — all with fakes.
 */
import { describe, it, expect } from 'vitest';
import { DarkWebSearchService } from '../src/main/browser/darkweb/runtime/search-service';
import { DarkWebCrawlerService } from '../src/main/browser/darkweb/runtime/crawler';
import { DarkWebLocalIndex } from '../src/main/browser/darkweb/runtime/local-index';
import { DarkWebProviderRegistry } from '../src/main/browser/darkweb/runtime/providers';
import { ProviderHealthTracker } from '../src/main/browser/darkweb/pure/provider-health';
import { validateDarkWebConfig } from '../src/main/browser/darkweb/pure/darkweb-config';
import type { DarkWebProvider, ProviderFetchPort } from '../src/main/browser/darkweb/runtime/providers';
import type { DarkWebFetcher } from '../src/main/browser/darkweb/runtime/fetcher';
import { makeIdGen, memoryStorage } from './_helpers';

const A = 'a'.repeat(56);
const B = 'b'.repeat(56);

function makeConfig(over: Record<string, unknown> = {}) {
  return validateDarkWebConfig({ storeSearchHistory: true, ...over }).config;
}

function makeDeps(over: Record<string, unknown> = {}) {
  const config = makeConfig(over);
  const registry = new DarkWebProviderRegistry();
  return {
    config,
    getConfig: () => config,
    registry,
    fetcher: { checkReachable: async () => ({ reachable: true, checkedAt: Date.now(), errorCode: null }) } as unknown as DarkWebFetcher,
    health: new ProviderHealthTracker(),
    history: { add: async () => {}, list: async () => [], clear: async () => {} } as never,
    /** Register AND enable in config (production enables via config). */
    register: (p: DarkWebProvider) => {
      registry.register(p);
      config.providers[p.id] = { enabled: true };
    },
  };
}

function provider(id: string, impl: DarkWebProvider['search'], requiresTor = false): DarkWebProvider {
  return { id, name: id, requiresTor, search: impl };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('DarkWebSearchService', () => {
  it('runs providers in parallel, normalizes, dedups and ranks', async () => {
    const deps = makeDeps();
    deps.register(
      provider('ahmia', async () => [
        { title: 'Market Alpha', url: `http://${A}.onion/`, snippet: 'alpha market', lastSeen: null },
        { title: 'Shared', url: `http://${B}.onion/x`, snippet: 'shared', lastSeen: null },
      ])
    );
    deps.register(
      provider('tor66', async () => [{ title: 'Alpha again', url: `http://${A}.onion`, snippet: '' }])
    );
    const svc = new DarkWebSearchService({ ...deps });
    const first = await svc.search({ query: 'alpha market' });
    const final = await pollUntilDone(svc, first.searchId);
    expect(final.state).toBe('DONE');
    expect(final.total).toBe(2); // 3 raw → dedup to 2
    const alpha = final.results.find((r) => r.hostname === `${A}.onion`);
    expect(alpha?.providers.sort()).toEqual(['ahmia', 'tor66']);
    expect(final.providers.ahmia?.status).toBe('ok');
    expect(final.providers.tor66?.resultCount).toBe(1);
  });

  it('survives one provider failing and one hanging (timeout)', async () => {
    const deps = makeDeps({ search: { providerTimeoutMs: 200, availability: { enabled: false } } });
    deps.register(provider('okp', async () => [{ title: 't', url: `http://${A}.onion/`, snippet: '' }]));
    deps.register(provider('errp', async () => { throw new Error('EXTERNAL_PROVIDER_UNAVAILABLE: dead'); }));
    deps.register(provider('hangp', () => sleep(5_000).then(() => [])));
    const svc = new DarkWebSearchService({ ...deps });
    const first = await svc.search({ query: 'q' });
    const final = await pollUntilDone(svc, first.searchId, 5000);
    expect(final.state).toBe('DONE');
    expect(final.providers.okp?.status).toBe('ok');
    expect(final.providers.errp?.status).toBe('error');
    expect(final.providers.hangp?.status).toBe('timeout');
    expect(final.total).toBe(1);
  }, 10_000);

  it('supports cancellation (spec §24/§52)', async () => {
    const deps = makeDeps({ search: { availability: { enabled: false } } });
    deps.register(provider('slow', () => sleep(3_000).then(() => [])));
    const svc = new DarkWebSearchService({ ...deps });
    const first = await svc.search({ query: 'q' });
    expect(svc.cancelSearch(first.searchId)).toBe(true);
    const final = await pollUntilDone(svc, first.searchId, 5000);
    expect(final.state).toBe('CANCELLED');
  }, 10_000);

  it('caches a completed search (spec §64)', async () => {
    const deps = makeDeps({ search: { cacheTtlMs: 60_000, availability: { enabled: false } } });
    let calls = 0;
    deps.register(provider('p', async () => {
      calls += 1;
      return [{ title: 't', url: `http://${A}.onion/`, snippet: '' }];
    }));
    const svc = new DarkWebSearchService({ ...deps });
    const r1 = await svc.search({ query: 'cache me' });
    await pollUntilDone(svc, r1.searchId);
    const r2 = await svc.search({ query: 'cache me' });
    expect(r2.searchId).toBe('cached');
    expect(calls).toBe(1);
  });

  it('records history only when enabled (spec §65)', async () => {
    const stored: string[] = [];
    const base = makeDeps({ search: { availability: { enabled: false } } });
    const historyDeps = {
      ...base,
      history: { add: async (q: string) => void stored.push(q), list: async () => [], clear: async () => {} } as never,
    };
    historyDeps.register(provider('p', async () => [{ title: 't', url: `http://${A}.onion/`, snippet: '' }]));
    const svc = new DarkWebSearchService(historyDeps);
    const r = await svc.search({ query: 'stored', useCache: false });
    await pollUntilDone(svc, r.searchId);
    expect(stored).toContain('stored');
  });

  it('skips history when disabled (spec §65)', async () => {
    const stored: string[] = [];
    const deps = makeDeps({ storeSearchHistory: false, search: { availability: { enabled: false } } });
    const svc = new DarkWebSearchService({
      ...deps,
      history: { add: async (q: string) => void stored.push(q), list: async () => [], clear: async () => {} } as never,
    });
    deps.register(provider('p', async () => [{ title: 't', url: `http://${A}.onion/`, snippet: '' }]));
    const r = await svc.search({ query: 'not-stored', useCache: false });
    await pollUntilDone(svc, r.searchId);
    expect(stored).toHaveLength(0);
  });
});

async function pollUntilDone(svc: DarkWebSearchService, id: string, maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  let snap = svc.getSearch(id);
  while (snap && snap.state !== 'DONE' && snap.state !== 'ERROR' && snap.state !== 'CANCELLED' && Date.now() < deadline) {
    await sleep(50);
    snap = svc.getSearch(id);
  }
  expect(snap).not.toBeNull();
  return snap!;
}

describe('DarkWebCrawlerService (spec §22–§24)', () => {
  function makeCrawler(over: Record<string, unknown> = {}) {
    const index = new DarkWebLocalIndex(memoryStorage(), 100, makeIdGen('doc'));
    const pages = new Map<string, string>();
    const config = makeConfig({ crawler: { maxDepth: 2, maxPages: 5, concurrency: 2, sameHostOnly: true }, ...over });
    const fetchCalls: string[] = [];
    const timing = { delayMs: 0 };
    const fetcher = {
      fetch: async (url: string, opts: { signal?: AbortSignal }) => {
        fetchCalls.push(url);
        // Simulate in-flight abort (spec §24: current requests abort).
        if (opts.signal?.aborted) throw new Error('aborted');
        if (timing.delayMs > 0) await sleep(timing.delayMs);
        const html = pages.get(url);
        if (html === undefined) throw new Error('ONION_UNREACHABLE');
        return {
          status: 200,
          contentType: 'text/html',
          text: html,
          body: Buffer.from(html),
          finalUrl: url,
          bytes: html.length,
          durationMs: 1,
          truncated: false,
        };
      },
    } as unknown as DarkWebFetcher;
    const crawler = new DarkWebCrawlerService({
      getConfig: () => config,
      fetcher,
      index,
      genId: makeIdGen('crawl'),
    });
    return { crawler, index, pages, fetchCalls, config, timing };
  }

  it('respects maxPages and sameHostOnly', async () => {
    const { crawler, pages } = makeCrawler();
    pages.set(`http://${A}.onion/`, `<a href="/1">1</a><a href="/2">2</a><a href="/3">3</a>`);
    for (const p of ['1', '2', '3']) pages.set(`http://${A}.onion/${p}`, `<p>page ${p}</p>`);
    const { jobId } = crawler.crawl({ url: `http://${A}.onion/`, maxDepth: 1, maxPages: 2 });
    await waitForTerminal(crawler, jobId);
    const st = crawler.status(jobId)!;
    expect(st.pagesFetched).toBeLessThanOrEqual(2);
    expect(st.state).toBe('DONE');
  });

  it('does not leave the seed host when sameHostOnly', async () => {
    const { crawler, pages, fetchCalls } = makeCrawler();
    pages.set(
      `http://${A}.onion/`,
      `<a href="http://${B}.onion/out">out</a><a href="/in">in</a>`
    );
    pages.set(`http://${A}.onion/in`, '<p>in</p>');
    pages.set(`http://${B}.onion/out`, '<p>out</p>');
    const { jobId } = crawler.crawl({ url: `http://${A}.onion/`, maxDepth: 1, maxPages: 5 });
    await waitForTerminal(crawler, jobId);
    expect(fetchCalls.some((u) => u.includes(`${B}.onion`))).toBe(false);
    expect(fetchCalls.some((u) => u.includes(`${A}.onion/in`))).toBe(true);
  });

  it('cancels: no new requests, terminal state CANCELLED', async () => {
    const { crawler, pages, fetchCalls, timing } = makeCrawler({ crawler: { concurrency: 1 } });
    for (let i = 0; i < 12; i++) pages.set(`http://${A}.onion/p${i}`, `<a href="/p${i + 1}">next</a><p>doc</p>`);
    // Generous per-page delay so the job cannot finish before the cancel
    // lands even under full-suite CPU contention.
    timing.delayMs = 100;
    const { jobId } = crawler.crawl({ url: `http://${A}.onion/p0`, maxDepth: 3, maxPages: 12 });
    await sleep(120);
    expect(crawler.cancel(jobId)).toBe(true);
    await waitForTerminal(crawler, jobId);
    const st = crawler.status(jobId)!;
    expect(st.state).toBe('CANCELLED');
    const after = fetchCalls.length;
    await sleep(80);
    expect(fetchCalls.length).toBeLessThanOrEqual(after + 1); // scheduling stopped
  }, 10_000);

  it('dedupes identical content via content hash (spec §27)', async () => {
    const { crawler, index, pages } = makeCrawler();
    const same = '<p>identical body text</p>';
    pages.set(`http://${A}.onion/x`, `<a href="/y"></a>${same}`);
    pages.set(`http://${A}.onion/y`, same);
    const { jobId } = crawler.crawl({ url: `http://${A}.onion/x`, maxDepth: 1, maxPages: 5 });
    await waitForTerminal(crawler, jobId);
    const st = crawler.status(jobId)!;
    expect(st.docsAdded).toBe(1);
    expect(st.docsDuplicate).toBe(1);
    expect(await index.size()).toBe(1);
  });

  it('refuses non-onion seeds', () => {
    const { crawler } = makeCrawler();
    expect(() => crawler.crawl({ url: 'https://example.com/' })).toThrow(/not_onion_host/);
  });
});

async function waitForTerminal(crawler: DarkWebCrawlerService, jobId: string, maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const st = crawler.status(jobId);
    if (st && st.endedAt !== null) return st;
    if (Date.now() > deadline) throw new Error('crawler test timeout');
    await sleep(25);
  }
}

describe('DarkWebLocalIndex (spec §25–§27)', () => {
  it('adds, searches and clears', async () => {
    const index = new DarkWebLocalIndex(memoryStorage(), 10, makeIdGen('doc'));
    await index.add({ url: `http://${A}.onion/`, host: `${A}.onion`, title: 'Tor Market', text: 'weapons and escrow marketplace listing', fetchedAt: 1, provider: null, crawlJobId: null });
    await index.add({ url: `http://${B}.onion/`, host: `${B}.onion`, title: 'Blog', text: 'cooking recipes', fetchedAt: 2, provider: null, crawlJobId: null });
    const hits = await index.search('marketplace', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Tor Market');
    expect(await index.size()).toBe(2);
    await index.clear();
    expect(await index.size()).toBe(0);
    expect(await index.search('marketplace', 10)).toHaveLength(0);
  });

  it('rejects duplicate content by hash', async () => {
    const index = new DarkWebLocalIndex(memoryStorage(), 10, makeIdGen('doc'));
    const r1 = await index.add({ url: `http://${A}.onion/a`, host: 'h', title: 'T', text: 'same text', fetchedAt: 1, provider: null, crawlJobId: null });
    const r2 = await index.add({ url: `http://${A}.onion/b`, host: 'h', title: 'T', text: 'SAME  TEXT', fetchedAt: 2, provider: null, crawlJobId: null });
    expect(r1.added).toBe(true);
    expect(r2.added).toBe(false);
    expect(r2.reason).toBe('duplicate_content');
  });

  it('caps size, dropping oldest', async () => {
    const index = new DarkWebLocalIndex(memoryStorage(), 3, makeIdGen('doc'));
    for (let i = 0; i < 5; i++) {
      await index.add({ url: `http://${A}.onion/${i}`, host: 'h', title: `t${i}`, text: `zzdoc${i} body`, fetchedAt: i, provider: null, crawlJobId: null });
    }
    expect(await index.size()).toBe(3);
    const oldest = await index.search('zzdoc0', 10);
    expect(oldest).toHaveLength(0); // oldest trimmed
    const newest = await index.search('zzdoc4', 10);
    expect(newest).toHaveLength(1);
  });
});

// ProviderFetchPort is referenced only for the type surface — keep the
// import honest.
void (undefined as unknown as ProviderFetchPort | undefined);
