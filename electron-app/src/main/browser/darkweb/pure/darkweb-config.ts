/**
 * Dark-web config — the SINGLE source of every limit in the subsystem
 * (spec §37/§38: no magic numbers scattered through the code).
 *
 * Hand-rolled validator + clamps, consistent with the project's existing
 * pure validators (tool-validator / vault-record-validator) — the project
 * has no schema library dependency, and none is introduced here.
 *
 * PURE LOGIC — no electron, no node imports.
 */
import type { DarkWebConfig, DarkWebSettingsPatch } from '@shared/darkweb-types';

/** Hard caps — user config is CLAMPED into these bounds, never trusted. */
export const DARKWEB_HARD_BOUNDS = {
  socksPort: { min: 1, max: 65535, default: 9050 },
  torProbeTimeoutMs: { min: 1_000, max: 30_000, default: 8_000 },
  searchGlobalTimeoutMs: { min: 3_000, max: 120_000, default: 30_000 },
  searchProviderTimeoutMs: { min: 1_000, max: 60_000, default: 15_000 },
  searchMaxResults: { min: 1, max: 200, default: 50 },
  availabilityMaxUrls: { min: 0, max: 50, default: 12 },
  availabilityConcurrency: { min: 1, max: 8, default: 4 },
  availabilityTimeoutMs: { min: 1_000, max: 30_000, default: 8_000 },
  searchCacheTtlMs: { min: 0, max: 3_600_000, default: 600_000 },
  fetchTimeoutMs: { min: 1_000, max: 120_000, default: 25_000 },
  fetchMaxBytes: { min: 4_096, max: 10_485_760, default: 2_097_152 },
  fetchMaxRedirects: { min: 0, max: 8, default: 4 },
  crawlerMaxDepth: { min: 1, max: 5, default: 1 },
  crawlerMaxPages: { min: 1, max: 200, default: 25 },
  crawlerConcurrency: { min: 1, max: 8, default: 2 },
  crawlerTimeoutMs: { min: 3_000, max: 300_000, default: 120_000 },
  providerCount: { min: 0, max: 10, default: 3 },
  titleMatch: { min: 0, max: 10, default: 2 },
  snippetMatch: { min: 0, max: 10, default: 0.5 },
  urlMatch: { min: 0, max: 10, default: 1 },
  reachable: { min: 0, max: 10, default: 1.5 },
  freshness: { min: 0, max: 10, default: 0.5 },
} as const;

export const DEFAULT_DARKWEB_CONFIG: Readonly<DarkWebConfig> = Object.freeze({
  enabled: true,
  tor: {
    socksHost: '127.0.0.1',
    socksPort: DARKWEB_HARD_BOUNDS.socksPort.default,
    spawnIfAvailable: true,
    binaryPath: null,
    probeUrl: 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/',
    probeTimeoutMs: DARKWEB_HARD_BOUNDS.torProbeTimeoutMs.default,
  },
  search: {
    globalTimeoutMs: DARKWEB_HARD_BOUNDS.searchGlobalTimeoutMs.default,
    providerTimeoutMs: DARKWEB_HARD_BOUNDS.searchProviderTimeoutMs.default,
    maxResults: DARKWEB_HARD_BOUNDS.searchMaxResults.default,
    availability: {
      enabled: true,
      maxUrls: DARKWEB_HARD_BOUNDS.availabilityMaxUrls.default,
      concurrency: DARKWEB_HARD_BOUNDS.availabilityConcurrency.default,
      timeoutMs: DARKWEB_HARD_BOUNDS.availabilityTimeoutMs.default,
    },
    cacheTtlMs: DARKWEB_HARD_BOUNDS.searchCacheTtlMs.default,
  },
  fetch: {
    timeoutMs: DARKWEB_HARD_BOUNDS.fetchTimeoutMs.default,
    maxBytes: DARKWEB_HARD_BOUNDS.fetchMaxBytes.default,
    maxRedirects: DARKWEB_HARD_BOUNDS.fetchMaxRedirects.default,
  },
  crawler: {
    maxDepth: DARKWEB_HARD_BOUNDS.crawlerMaxDepth.default,
    maxPages: DARKWEB_HARD_BOUNDS.crawlerMaxPages.default,
    sameHostOnly: true,
    concurrency: DARKWEB_HARD_BOUNDS.crawlerConcurrency.default,
    timeoutMs: DARKWEB_HARD_BOUNDS.crawlerTimeoutMs.default,
  },
  providers: {
    ahmia: { enabled: true },
    tor66: { enabled: true },
  },
  ranking: {
    providerCount: DARKWEB_HARD_BOUNDS.providerCount.default,
    titleMatch: DARKWEB_HARD_BOUNDS.titleMatch.default,
    snippetMatch: DARKWEB_HARD_BOUNDS.snippetMatch.default,
    urlMatch: DARKWEB_HARD_BOUNDS.urlMatch.default,
    reachable: DARKWEB_HARD_BOUNDS.reachable.default,
    freshness: DARKWEB_HARD_BOUNDS.freshness.default,
  },
  storeSearchHistory: true,
  storeLocalIndex: true,
});

function clamp(value: unknown, bounds: { min: number; max: number; default: number }): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : bounds.default;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

function clampStr(value: unknown, fallback: string, maxLen: number): string {
  if (typeof value !== 'string') return fallback;
  const t = value.trim();
  if (t.length === 0 || t.length > maxLen) return fallback;
  return t;
}

/**
 * Validate + clamp an untrusted raw config (partial) into a complete
 * DarkWebConfig. Never throws; unknown fields are dropped; out-of-range
 * numbers are clamped to hard bounds. Returns validation errors for UI
 * diagnostics while STILL returning a safe config.
 */
export function validateDarkWebConfig(raw: unknown): {
  valid: boolean;
  errors: string[];
  config: DarkWebConfig;
} {
  const errors: string[] = [];
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_DARKWEB_CONFIG;

  const tor = (src.tor ?? {}) as Record<string, unknown>;
  const socksPort = clamp(tor.socksPort ?? d.tor.socksPort, DARKWEB_HARD_BOUNDS.socksPort);
  if (typeof tor.socksPort === 'number' && Math.round(tor.socksPort) !== socksPort) {
    errors.push(`tor.socksPort clamped to ${socksPort}`);
  }
  const socksHostRaw = clampStr(tor.socksHost, d.tor.socksHost, 253);
  const socksHost = /^[a-z0-9.-]+$/i.test(socksHostRaw) ? socksHostRaw : d.tor.socksHost;
  if (socksHost !== socksHostRaw) {
    errors.push(`tor.socksHost invalid, defaulted to ${d.tor.socksHost}`);
  }
  const probeUrl = clampStr(tor.probeUrl, d.tor.probeUrl, 2048);
  if (!/^http:\/\/[a-z2-7]{56}\.onion\/?$/i.test(probeUrl)) {
    errors.push(`tor.probeUrl must be an http .onion URL, defaulted`);
  }

  const search = (src.search ?? {}) as Record<string, unknown>;
  const availability = (search.availability ?? {}) as Record<string, unknown>;

  const fetchCfg = (src.fetch ?? {}) as Record<string, unknown>;
  const crawler = (src.crawler ?? {}) as Record<string, unknown>;
  const ranking = (src.ranking ?? {}) as Record<string, unknown>;

  const providers: Record<string, { enabled: boolean }> = {};
  const rawProviders = (src.providers ?? {}) as Record<string, unknown>;
  for (const [id, value] of Object.entries(rawProviders)) {
    if (!/^[a-z0-9_]{1,32}$/.test(id)) continue;
    const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    providers[id] = { enabled: v.enabled === true };
  }
  for (const [id, def] of Object.entries(d.providers)) {
    if (!(id in providers)) providers[id] = { ...def };
  }

  const config: DarkWebConfig = {
    enabled: src.enabled === undefined ? d.enabled : src.enabled === true,
    tor: {
      socksHost,
      socksPort,
      spawnIfAvailable: tor.spawnIfAvailable === undefined ? d.tor.spawnIfAvailable : tor.spawnIfAvailable === true,
      binaryPath: typeof tor.binaryPath === 'string' && tor.binaryPath.length > 0 ? tor.binaryPath : null,
      probeUrl,
      probeTimeoutMs: clamp(tor.probeTimeoutMs ?? d.tor.probeTimeoutMs, DARKWEB_HARD_BOUNDS.torProbeTimeoutMs),
    },
    search: {
      globalTimeoutMs: clamp(search.globalTimeoutMs ?? d.search.globalTimeoutMs, DARKWEB_HARD_BOUNDS.searchGlobalTimeoutMs),
      providerTimeoutMs: clamp(search.providerTimeoutMs ?? d.search.providerTimeoutMs, DARKWEB_HARD_BOUNDS.searchProviderTimeoutMs),
      maxResults: clamp(search.maxResults ?? d.search.maxResults, DARKWEB_HARD_BOUNDS.searchMaxResults),
      availability: {
        enabled: availability.enabled === undefined ? d.search.availability.enabled : availability.enabled === true,
        maxUrls: clamp(availability.maxUrls ?? d.search.availability.maxUrls, DARKWEB_HARD_BOUNDS.availabilityMaxUrls),
        concurrency: clamp(availability.concurrency ?? d.search.availability.concurrency, DARKWEB_HARD_BOUNDS.availabilityConcurrency),
        timeoutMs: clamp(availability.timeoutMs ?? d.search.availability.timeoutMs, DARKWEB_HARD_BOUNDS.availabilityTimeoutMs),
      },
      cacheTtlMs: clamp(search.cacheTtlMs ?? d.search.cacheTtlMs, DARKWEB_HARD_BOUNDS.searchCacheTtlMs),
    },
    fetch: {
      timeoutMs: clamp(fetchCfg.timeoutMs ?? d.fetch.timeoutMs, DARKWEB_HARD_BOUNDS.fetchTimeoutMs),
      maxBytes: clamp(fetchCfg.maxBytes ?? d.fetch.maxBytes, DARKWEB_HARD_BOUNDS.fetchMaxBytes),
      maxRedirects: clamp(fetchCfg.maxRedirects ?? d.fetch.maxRedirects, DARKWEB_HARD_BOUNDS.fetchMaxRedirects),
    },
    crawler: {
      maxDepth: clamp(crawler.maxDepth ?? d.crawler.maxDepth, DARKWEB_HARD_BOUNDS.crawlerMaxDepth),
      maxPages: clamp(crawler.maxPages ?? d.crawler.maxPages, DARKWEB_HARD_BOUNDS.crawlerMaxPages),
      sameHostOnly: crawler.sameHostOnly === undefined ? d.crawler.sameHostOnly : crawler.sameHostOnly === true,
      concurrency: clamp(crawler.concurrency ?? d.crawler.concurrency, DARKWEB_HARD_BOUNDS.crawlerConcurrency),
      timeoutMs: clamp(crawler.timeoutMs ?? d.crawler.timeoutMs, DARKWEB_HARD_BOUNDS.crawlerTimeoutMs),
    },
    providers,
    ranking: {
      providerCount: clamp(ranking.providerCount ?? d.ranking.providerCount, DARKWEB_HARD_BOUNDS.providerCount),
      titleMatch: clamp(ranking.titleMatch ?? d.ranking.titleMatch, DARKWEB_HARD_BOUNDS.titleMatch),
      snippetMatch: clamp(ranking.snippetMatch ?? d.ranking.snippetMatch, DARKWEB_HARD_BOUNDS.snippetMatch),
      urlMatch: clamp(ranking.urlMatch ?? d.ranking.urlMatch, DARKWEB_HARD_BOUNDS.urlMatch),
      reachable: clamp(ranking.reachable ?? d.ranking.reachable, DARKWEB_HARD_BOUNDS.reachable),
      freshness: clamp(ranking.freshness ?? d.ranking.freshness, DARKWEB_HARD_BOUNDS.freshness),
    },
    storeSearchHistory: src.storeSearchHistory === undefined ? d.storeSearchHistory : src.storeSearchHistory === true,
    storeLocalIndex: src.storeLocalIndex === undefined ? d.storeLocalIndex : src.storeLocalIndex === true,
  };

  return { valid: errors.length === 0, errors, config };
}

/** Merge a settings patch (UI / config file) onto an existing config. */
export function applySettingsPatch(current: DarkWebConfig, patch: DarkWebSettingsPatch): DarkWebConfig {
  return validateDarkWebConfig({
    ...current,
    enabled: patch.enabled ?? current.enabled,
    storeSearchHistory: patch.storeSearchHistory ?? current.storeSearchHistory,
    storeLocalIndex: patch.storeLocalIndex ?? current.storeLocalIndex,
    tor: {
      ...current.tor,
      ...(patch.tor ?? {}),
    },
    search: {
      ...current.search,
      ...(patch.search ?? {}),
      availability: { ...current.search.availability },
    },
    crawler: {
      ...current.crawler,
      ...(patch.crawler ?? {}),
    },
    providers: {
      ...current.providers,
      ...(patch.providers ?? {}),
    },
  }).config;
}
