/**
 * DarkWebSearchService — the search orchestrator (spec §7–§9, §51/§52).
 *
 * Per search:
 *   - enabled providers run in PARALLEL, each with its own timeout;
 *   - one failing/hanging provider never fails the search (per-provider
 *     report carries the safe error code);
 *   - results are normalized → merged (dedup) → aggregate-ranked →
 *     (bounded, concurrent) availability-checked through Tor;
 *   - partial results become visible while remaining providers still run
 *     (page polls GET /api/search/:id);
 *   - searches are cacheable (short TTL) and cancellable.
 *
 * No LLM anywhere on this path. Search is metadata-only: nothing is
 * auto-opened/auto-fetched beyond the bounded availability probe.
 */
import {
  normalizeProviderResult,
  mergeResults,
  type RawProviderResult,
} from '../pure/normalize';
import { rankResults, weightsFromConfig } from '../pure/rank';
import type { DarkWebProviderRegistry } from './providers';
import type { DarkWebFetcher } from './fetcher';
import type { ProviderHealthTracker } from '../pure/provider-health';
import type { DarkWebSearchHistory } from './local-index';
import type {
  DarkWebSearchResponse,
  DarkWebSearchResult,
  DarkWebProviderReport,
  ProviderRunStatus,
  DarkWebConfig,
} from '@shared/darkweb-types';

interface SearchJob {
  searchId: string;
  query: string;
  state: DarkWebSearchResponse['state'];
  results: DarkWebSearchResult[];
  providers: Record<string, DarkWebProviderReport>;
  startedAt: number;
  endedAt: number | null;
  errorCode: string | null;
  cancelled: boolean;
  /** Providers that have settled (ok/error) — used for PARTIAL_RESULTS. */
  settled: number;
  registered: number;
}

export interface SearchServiceDeps {
  getConfig: () => DarkWebConfig;
  registry: DarkWebProviderRegistry;
  fetcher: DarkWebFetcher;
  health: ProviderHealthTracker;
  history: DarkWebSearchHistory;
  now?: () => number;
  genId?: () => string;
}

const JOB_TTL_MS = 10 * 60 * 1000;
const MAX_JOBS = 24;
const MAX_CACHE_ENTRIES = 50;

interface CacheEntry {
  results: DarkWebSearchResult[];
  providers: Record<string, DarkWebProviderReport>;
  expiresAt: number;
}

export class DarkWebSearchService {
  private readonly jobs = new Map<string, SearchJob>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly genId: () => string;

  constructor(private readonly deps: SearchServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.genId = deps.genId ?? (() => `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  }

  /**
   * Start a search. Resolves immediately with the job shell (state
   * SEARCHING); results stream in as providers settle — poll getSearch().
   * With `wait=true` it resolves when the job reaches a terminal state
   * (used by MCP tools that want one structured response).
   */
  async search(request: {
    query: string;
    providers?: string[];
    limit?: number;
    timeoutMs?: number;
    wait?: boolean;
    useCache?: boolean;
  }): Promise<DarkWebSearchResponse> {
    const config = this.deps.getConfig();
    if (!config.enabled) {
      throw new Error('DARKWEB_DISABLED');
    }
    const query = String(request.query ?? '').trim();
    if (query.length === 0) throw new Error('EMPTY_QUERY');
    if (query.length > 512) throw new Error('QUERY_TOO_LONG');

    const cacheKey = cacheKeyFor(query, request.providers);
    if ((request.useCache ?? true) && config.search.cacheTtlMs > 0) {
      const hit = this.cache.get(cacheKey);
      if (hit && this.now() < hit.expiresAt) {
        return this.snapshot({
          searchId: 'cached',
          query,
          state: 'DONE',
          results: hit.results,
          providers: hit.providers,
          startedAt: this.now(),
          endedAt: this.now(),
          errorCode: null,
          cancelled: false,
          settled: 0,
          registered: 0,
        });
      }
    }

    const requested = new Set((request.providers ?? []).filter((p) => typeof p === 'string'));
    const enabled = this.deps.registry.getEnabled((id) => {
      const cfgEnabled = config.providers[id]?.enabled === true;
      if (requested.size > 0) return cfgEnabled && requested.has(id);
      return cfgEnabled;
    });
    // Circuit breaker: skip providers that are OFFLINE with the circuit open.
    const runnable = enabled.filter((p) => this.deps.health.allow(p.id));

    const job: SearchJob = {
      searchId: this.genId(),
      query,
      state: 'SEARCHING',
      results: [],
      providers: {},
      startedAt: this.now(),
      endedAt: null,
      errorCode: null,
      cancelled: false,
      settled: 0,
      registered: runnable.length,
    };
    this.pruneJobs();
    this.jobs.set(job.searchId, job);

    if (runnable.length === 0) {
      job.state = 'DONE';
      job.endedAt = this.now();
      job.errorCode = enabled.length > 0 ? 'ALL_PROVIDERS_CIRCUIT_OPEN' : 'NO_PROVIDERS_ENABLED';
      const snap = this.snapshot(job);
      this.maybeCache(cacheKey, snap, config);
      return snap;
    }

    const globalTimeoutMs = Math.min(request.timeoutMs ?? config.search.globalTimeoutMs, config.search.globalTimeoutMs);
    const limit = Math.min(Math.max(1, request.limit ?? config.search.maxResults), config.search.maxResults);

    const globalTimer = setTimeout(() => {
      if (job.state === 'SEARCHING' || job.state === 'PARTIAL_RESULTS') {
        job.cancelled = true;
        job.state = 'DONE'; // global budget reached — deliver what we have
        job.endedAt = this.now();
      }
    }, globalTimeoutMs);

    // Fire every provider; each is individually capped + isolated.
    const providerPromises = runnable.map(async (provider) => {
      const startedAt = this.now();
      const report: DarkWebProviderReport = {
        id: provider.id,
        status: 'ok',
        durationMs: 0,
        resultCount: 0,
        errorCode: null,
      };
      job.providers[provider.id] = report;
      try {
        const raw = await withTimeout(
          provider.search(query, { limit, timeoutMs: config.search.providerTimeoutMs }),
          config.search.providerTimeoutMs,
          provider.id
        );
        if (job.cancelled) return { provider, raw: [] as RawProviderResult[] };
        report.status = 'ok';
        report.resultCount = raw.length;
        report.durationMs = this.now() - startedAt;
        this.deps.health.recordSuccess(provider.id, report.durationMs);
        return { provider, raw };
      } catch (err) {
        report.durationMs = this.now() - startedAt;
        const code = err instanceof Error && /^(TIMEOUT:)/.test(err.message)
          ? 'timeout'
          : 'error';
        report.status = code as ProviderRunStatus;
        report.errorCode = err instanceof Error
          ? (err.message.split('\n')[0] ?? 'PROVIDER_ERROR').slice(0, 120)
          : 'PROVIDER_ERROR';
        this.deps.health.recordFailure(provider.id);
        return { provider, raw: [] as RawProviderResult[] };
      } finally {
        job.settled += 1;
        if (!job.cancelled && job.settled < job.registered && job.state === 'SEARCHING') {
          job.state = 'PARTIAL_RESULTS';
        }
      }
    });

    void (async () => {
      try {
        const settledResults = await Promise.all(providerPromises);
        if (job.cancelled) {
          job.state = 'CANCELLED';
          job.endedAt = this.now();
          return;
        }
        const normalized = settledResults.flatMap(({ provider, raw }) =>
          raw.map((r) => normalizeProviderResult(r, provider.id)).filter((n) => n !== null)
        );
        const merged = mergeResults(normalized);

        // Bounded availability check through Tor (spec §7 availability).
        const reachability = new Map<string, { reachable: 'yes' | 'no' | 'unknown'; checkedAt: number | null }>();
        if (config.search.availability.enabled && config.search.availability.maxUrls > 0) {
          const candidates = merged.slice(0, config.search.availability.maxUrls);
          await runBounded(candidates, config.search.availability.concurrency, async (m) => {
            if (job.cancelled) return;
            const check = await this.deps.fetcher.checkReachable(m.url, config.search.availability.timeoutMs);
            // An offline Tor gateway proves NOTHING about reachability —
            // report 'unknown', never a false 'no' (honest states, spec §51).
            reachability.set(m.key, {
              reachable: check.reachable
                ? 'yes'
                : check.errorCode === 'TOR_UNAVAILABLE'
                  ? 'unknown'
                  : 'no',
              checkedAt: check.checkedAt,
            });
          });
        }

        if (job.cancelled) {
          job.state = 'CANCELLED';
          job.endedAt = this.now();
          return;
        }

        const ranked = rankResults(merged, query, weightsFromConfig(config), reachability, this.now());
        job.results = ranked.slice(0, limit).map((r, i) => ({ ...r, id: `${job.searchId}_${i}` }));
        job.state = job.settled < job.registered ? 'PARTIAL_RESULTS' : 'DONE';
        job.endedAt = this.now();
        const snap = this.snapshot(job);
        this.maybeCache(cacheKey, snap, config);
        if (config.storeSearchHistory) {
          void this.deps.history.add(query, Object.keys(job.providers), this.now());
        }
      } catch (err) {
        job.state = 'ERROR';
        job.errorCode = err instanceof Error ? err.message.slice(0, 120) : 'SEARCH_FAILED';
        job.endedAt = this.now();
      } finally {
        clearTimeout(globalTimer);
      }
    })();

    const initial = this.snapshot(job);
    if (request.wait) {
      await waitForTerminal(job, initial);
      return this.snapshot(job);
    }
    return initial;
  }

  /** Poll one job. Unknown/expired ids resolve to null. */
  getSearch(searchId: string): DarkWebSearchResponse | null {
    const job = this.jobs.get(searchId);
    return job ? this.snapshot(job) : null;
  }

  /** Cooperative cancel: new provider work short-circuits; final state CANCELLED. */
  cancelSearch(searchId: string): boolean {
    const job = this.jobs.get(searchId);
    if (!job) return false;
    if (job.state === 'DONE' || job.state === 'ERROR' || job.state === 'CANCELLED') return true;
    job.cancelled = true;
    job.state = 'CANCELLED';
    job.endedAt = this.now();
    return true;
  }

  listActiveSearches(): DarkWebSearchResponse[] {
    return [...this.jobs.values()]
      .filter((j) => j.state === 'SEARCHING' || j.state === 'PARTIAL_RESULTS')
      .map((j) => this.snapshot(j));
  }

  private snapshot(job: SearchJob): DarkWebSearchResponse {
    return {
      searchId: job.searchId,
      query: job.query,
      state: job.state,
      results: job.results,
      providers: job.providers,
      total: job.results.length,
      durationMs: (job.endedAt ?? this.now()) - job.startedAt,
      errorCode: job.errorCode,
    };
  }

  private maybeCache(key: string, snap: DarkWebSearchResponse, config: DarkWebConfig): void {
    if (config.search.cacheTtlMs <= 0 || snap.state !== 'DONE') return;
    this.cache.set(key, {
      results: snap.results,
      providers: snap.providers,
      expiresAt: this.now() + config.search.cacheTtlMs,
    });
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  private pruneJobs(): void {
    const cutoff = this.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      const terminal = job.state === 'DONE' || job.state === 'ERROR' || job.state === 'CANCELLED';
      if (terminal && (job.endedAt ?? 0) < cutoff) this.jobs.delete(id);
    }
    while (this.jobs.size >= MAX_JOBS) {
      const oldest = this.jobs.keys().next().value;
      if (oldest === undefined) break;
      this.jobs.delete(oldest);
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label} exceeded ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runBounded<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      try {
        await fn(item);
      } catch {
        // Availability checks never fail the search.
      }
    }
  });
  await Promise.all(workers);
}

async function waitForTerminal(job: SearchJob, initial: DarkWebSearchResponse): Promise<DarkWebSearchResponse> {
  let current = initial;
  const deadline = Date.now() + 150_000;
  while (
    (current.state === 'SEARCHING' || current.state === 'PARTIAL_RESULTS') &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 150));
    current = {
      ...current,
      state: job.state,
      results: job.results,
      providers: job.providers,
      total: job.results.length,
      durationMs: (job.endedAt ?? Date.now()) - job.startedAt,
      errorCode: job.errorCode,
    };
  }
  return current;
}

function cacheKeyFor(query: string, providers?: string[]): string {
  const p = [...(providers ?? [])].sort().join(',');
  return `${query.trim().toLowerCase()}|${p}`;
}
