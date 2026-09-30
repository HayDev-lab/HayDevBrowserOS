/**
 * Dark-web config validation/clamping (spec §37/§38) + normalize/dedupe/rank
 * + content hash + provider health (spec §34/§35).
 */
import { describe, it, expect } from 'vitest';
import { validateDarkWebConfig, applySettingsPatch, DEFAULT_DARKWEB_CONFIG } from '../src/main/browser/darkweb/pure/darkweb-config';
import { normalizeProviderResult, mergeResults } from '../src/main/browser/darkweb/pure/normalize';
import { rankResults, extractQueryTerms } from '../src/main/browser/darkweb/pure/rank';
import { contentHash, normalizeTextForHash } from '../src/main/browser/darkweb/pure/content-hash';
import { ProviderHealthTracker } from '../src/main/browser/darkweb/pure/provider-health';

describe('darkweb config', () => {
  it('defaults validate cleanly', () => {
    const r = validateDarkWebConfig(null);
    expect(r.valid).toBe(true);
    expect(r.config.tor.socksPort).toBe(9050);
    expect(r.config.crawler).toMatchObject({ maxDepth: 1, maxPages: 25, sameHostOnly: true, concurrency: 2 });
    expect(r.config.providers.ahmia?.enabled).toBe(true);
    expect(r.config.providers.tor66?.enabled).toBe(true);
  });

  it('clamps out-of-range values instead of exploding', () => {
    const r = validateDarkWebConfig({
      fetch: { maxBytes: 999_999_999_999, timeoutMs: 1 },
      crawler: { maxPages: 100_000, maxDepth: 99, concurrency: 999 },
      tor: { socksPort: 0 },
    });
    expect(r.config.fetch.maxBytes).toBeLessThanOrEqual(10_485_760);
    expect(r.config.fetch.timeoutMs).toBeGreaterThanOrEqual(1000);
    expect(r.config.crawler.maxPages).toBeLessThanOrEqual(200);
    expect(r.config.crawler.maxDepth).toBe(5);
    expect(r.config.crawler.concurrency).toBeLessThanOrEqual(8);
    expect(r.config.tor.socksPort).toBe(1); // clamped into [1, 65535]
    expect(r.valid).toBe(false); // clamps are reported
  });

  it('drops unknown provider ids and invalid host chars', () => {
    const r = validateDarkWebConfig({
      providers: { ahmia: { enabled: true }, 'bad id!': { enabled: true } },
      tor: { socksHost: 'not a host!!' },
    });
    expect(r.config.providers['bad id!']).toBeUndefined();
    expect(r.config.tor.socksHost).toBe(DEFAULT_DARKWEB_CONFIG.tor.socksHost);
  });

  it('applies a settings patch through validation', () => {
    const cfg = applySettingsPatch(validateDarkWebConfig(null).config, {
      storeSearchHistory: false,
      crawler: { maxPages: 40 },
      providers: { ahmia: { enabled: false } },
    });
    expect(cfg.storeSearchHistory).toBe(false);
    expect(cfg.crawler.maxPages).toBe(40);
    expect(cfg.providers.ahmia?.enabled).toBe(false);
    expect(cfg.providers.tor66?.enabled).toBe(true);
  });
});

describe('normalize + dedupe (spec §7/§8)', () => {
  it('adds http:// to bare onion cites and lowercases host', () => {
    const n = normalizeProviderResult(
      { title: ' T ', url: 'AbCg2qExample.onion/Path', snippet: ' s ' },
      'ahmia'
    );
    expect(n).not.toBeNull();
    expect(n!.url).toMatch(/^http:\/\/abcg2qexample\.onion\/Path$/);
    expect(n!.hostname).toBe('abcg2qexample.onion');
    expect(n!.title).toBe('T');
  });

  it('rejects non-onion and non-http entries', () => {
    expect(normalizeProviderResult({ title: '', url: 'https://example.com/', snippet: '' }, 'x')).toBeNull();
    expect(normalizeProviderResult({ title: '', url: 'javascript:alert(1)', snippet: '' }, 'x')).toBeNull();
  });

  it('merges 4-engine duplicates into ONE result with providers union', () => {
    const raw = [
      normalizeProviderResult({ title: 'A', url: `http://g2q.onion/x`, snippet: 'short' }, 'robin')!,
    ];
    void raw;
    const entries = [
      normalizeProviderResult({ title: 'Alpha', url: `http://${'a'.repeat(56)}.onion/x`, snippet: 's1' }, 'ahmia')!,
      normalizeProviderResult({ title: 'Alpha page', url: `http://${'a'.repeat(56)}.onion/x/`, snippet: 'longer snippet here' }, 'tor66')!,
      normalizeProviderResult({ title: '', url: `http://${'a'.repeat(56)}.onion/x#frag`, snippet: '' }, 'robin')!,
      normalizeProviderResult({ title: '', url: `http://${'a'.repeat(56)}.onion/x?utm_source=spam`, snippet: '' }, 'darknetMcp')!,
    ];
    const merged = mergeResults(entries);
    expect(merged).toHaveLength(1);
    expect(merged[0].providers.sort()).toEqual(['ahmia', 'darknetMcp', 'robin', 'tor66']);
    expect(merged[0].snippet).toBe('longer snippet here');
  });

  it('keeps distinct paths separate', () => {
    const merged = mergeResults([
      normalizeProviderResult({ title: '', url: `http://${'a'.repeat(56)}.onion/a`, snippet: '' }, 'ahmia')!,
      normalizeProviderResult({ title: '', url: `http://${'a'.repeat(56)}.onion/b`, snippet: '' }, 'ahmia')!,
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('ranking (spec §9 — aggregate, LLM-free)', () => {
  const weights = { providerCount: 3, titleMatch: 2, snippetMatch: 0.5, urlMatch: 1, reachable: 1.5, freshness: 0.5 };
  const now = 1_000_000_000_000;

  it('multi-provider evidence outranks single-provider', () => {
    const m1 = { title: 'market', url: `http://${'a'.repeat(56)}.onion/`, hostname: 'x.onion', snippet: '', providers: ['ahmia'], lastSeen: null, key: 'k1' };
    const m2 = { title: 'market', url: `http://${'b'.repeat(56)}.onion/`, hostname: 'y.onion', snippet: '', providers: ['ahmia', 'tor66'], lastSeen: null, key: 'k2' };
    const reach = new Map();
    const scored = rankResults([m1, m2], 'market', weights, reach, now);
    expect(scored[0].providers).toHaveLength(2);
  });

  it('reachable results outrank unknown ones', () => {
    const a = { title: 'q', url: `http://${'a'.repeat(56)}.onion/`, hostname: 'x', snippet: '', providers: ['ahmia'], lastSeen: null, key: 'ka' };
    const b = { title: 'q', url: `http://${'b'.repeat(56)}.onion/`, hostname: 'y', snippet: '', providers: ['ahmia'], lastSeen: null, key: 'kb' };
    const reach = new Map([['ka', { reachable: 'yes' as const, checkedAt: now }]]);
    const scored = rankResults([a, b], 'q', weights, reach, now);
    expect(scored[0].url).toBe(a.url);
    expect(scored[0].reachable).toBe('yes');
  });

  it('title coverage contributes scoring', () => {
    const terms = extractQueryTerms('dark web market');
    expect(terms).toContain('dark');
    expect(terms).not.toContain('a'); // short tokens dropped
    const m = { title: 'The Dark Web Market', url: `http://${'a'.repeat(56)}.onion/`, hostname: 'x', snippet: '', providers: ['ahmia'], lastSeen: null, key: 'k' };
    const scored = rankResults([m], 'dark web market', weights, new Map(), now);
    expect(scored[0].score).toBeGreaterThan(2);
  });
});

describe('content hash (spec §27)', () => {
  it('is whitespace-insensitive and deterministic', () => {
    expect(contentHash('Hello   World')).toBe(contentHash('hello world'));
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
    expect(normalizeTextForHash('  A\n\n B ')).toBe('a b');
  });

  it('returns 16-char hex', () => {
    expect(contentHash('x')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('provider health + circuit breaker (spec §34/§35)', () => {
  it('degrades then opens the circuit, then half-opens after cooldown', () => {
    let t = 1_000_000;
    const tracker = new ProviderHealthTracker({ failureThreshold: 5, cooldownMs: 120_000 }, () => t);
    expect(tracker.allow('p')).toBe(true);
    for (let i = 0; i < 4; i++) tracker.recordFailure('p');
    expect(tracker.getStatus('p').health).toBe('DEGRADED');
    expect(tracker.allow('p')).toBe(true);
    tracker.recordFailure('p');
    expect(tracker.getStatus('p').health).toBe('OFFLINE');
    expect(tracker.allow('p')).toBe(false);
    t += 120_001;
    expect(tracker.allow('p')).toBe(true); // half-open probe allowed
    tracker.recordSuccess('p', 42);
    expect(tracker.getStatus('p').health).toBe('HEALTHY');
    expect(tracker.getStatus('p').lastLatencyMs).toBe(42);
  });

  it('tracks providers independently', () => {
    const tracker = new ProviderHealthTracker(undefined, () => 1_000_000);
    for (let i = 0; i < 6; i++) tracker.recordFailure('a');
    expect(tracker.allow('a')).toBe(false);
    expect(tracker.allow('b')).toBe(true);
  });
});
