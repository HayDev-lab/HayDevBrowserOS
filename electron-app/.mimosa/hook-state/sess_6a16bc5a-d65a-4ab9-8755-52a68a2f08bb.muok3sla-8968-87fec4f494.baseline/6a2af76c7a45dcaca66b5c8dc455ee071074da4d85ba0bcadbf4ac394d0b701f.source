/**
 * DarkWebCrawlerService — bounded onion crawler (spec §22/§23/§24).
 *
 * Native bounded BFS over the fetcher (same security gates: onion-only,
 * Tor-only, byte caps). The GoTor/TorBot CLI tools remain OPTIONAL future
 * adapters behind the same interface — the MVP deliberately avoids a
 * Python/Go runtime dependency and zombie-process risk (spec §59).
 *
 * Safe defaults (spec §23): maxDepth=1, maxPages=25, sameHostOnly=true,
 * concurrency=2 — all clamped through the central config bounds.
 *
 * Cancellation (spec §24): cancel() stops scheduling, aborts in-flight
 * sockets via AbortController, and the job settles as CANCELLED.
 */
import { validateOnionFetchUrl, isOnionHost } from '../pure/onion-url';
import { extractTitle, extractText, extractLinks } from '../pure/html-extract';
import { contentHash } from '../pure/content-hash';
import type { DarkWebFetcher } from './fetcher';
import type { DarkWebLocalIndex } from './local-index';
import type { DarkWebCrawlStatus, DarkWebConfig } from '@shared/darkweb-types';

interface CrawlJob extends DarkWebCrawlStatus {
  abort: AbortController;
  seen: Set<string>;
  queue: Array<{ url: string; depth: number }>;
  running: number;
  stopRequested: boolean;
}

export interface CrawlerDeps {
  getConfig: () => DarkWebConfig;
  fetcher: DarkWebFetcher;
  index: DarkWebLocalIndex;
  now?: () => number;
  genId?: () => string;
}

const MAX_JOBS = 8;
const TEXT_MAX_BYTES = 400_000; // per-page text cap before hashing/storing

export class DarkWebCrawlerService {
  private readonly jobs = new Map<string, CrawlJob>();
  private readonly now: () => number;
  private readonly genId: () => string;

  constructor(private readonly deps: CrawlerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.genId = deps.genId ?? (() => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  }

  /**
   * Start a crawl job; resolves immediately with jobId. Config values are
   * clamped by validateDarkWebConfig already — per-request overrides are
   * additionally clamped to the config envelope here.
   */
  crawl(request: { url: string; maxDepth?: number; maxPages?: number; sameHostOnly?: boolean }): { jobId: string } {
    const config = this.deps.getConfig();
    if (!config.enabled) throw new Error('DARKWEB_DISABLED');
    const validated = validateOnionFetchUrl(request.url);
    if (!validated.valid) throw new Error(validated.reason ?? 'invalid_url');

    this.pruneJobs();
    if (this.jobs.size >= MAX_JOBS) throw new Error('TOO_MANY_CRAWL_JOBS');

    const maxDepth = clampInt(request.maxDepth, 1, config.crawler.maxDepth);
    const maxPages = clampInt(request.maxPages, 1, config.crawler.maxPages);
    const sameHostOnly = request.sameHostOnly ?? config.crawler.sameHostOnly;
    const seedHost = validated.hostname!;

    const job: CrawlJob = {
      jobId: this.genId(),
      seedUrl: validated.url!,
      state: 'RUNNING',
      maxDepth,
      maxPages,
      sameHostOnly,
      pagesFetched: 0,
      pagesFailed: 0,
      pagesQueued: 1,
      docsAdded: 0,
      docsDuplicate: 0,
      startedAt: this.now(),
      endedAt: null,
      errorCode: null,
      abort: new AbortController(),
      seen: new Set([canonical(validated.url!)]),
      queue: [{ url: validated.url!, depth: 0 }],
      running: 0,
      stopRequested: false,
    };
    this.jobs.set(job.jobId, job);
    void this.run(job, seedHost, config);
    return { jobId: job.jobId };
  }

  private async run(job: CrawlJob, seedHost: string, config: DarkWebConfig): Promise<void> {
    const deadline = this.now() + config.crawler.timeoutMs;
    const concurrency = Math.max(1, config.crawler.concurrency);
    const workers = Array.from({ length: concurrency }, () => this.workerLoop(job, seedHost, deadline, config));
    await Promise.all(workers);
    if (job.endedAt === null) {
      job.state = job.stopRequested ? 'CANCELLED' : 'DONE';
      job.endedAt = this.now();
    }
  }

  private async workerLoop(job: CrawlJob, seedHost: string, deadline: number, config: DarkWebConfig): Promise<void> {
    for (;;) {
      if (job.stopRequested || job.abort.signal.aborted) return;
      if (this.now() > deadline) {
        job.errorCode = 'CRAWL_TIMEOUT';
        return;
      }
      if (job.pagesFetched + job.pagesFailed >= job.maxPages) return;
      const next = job.queue.shift();
      if (!next) return;
      job.running += 1;
      try {
        await this.fetchAndStore(job, next, seedHost, config);
      } catch {
        job.pagesFailed += 1;
      } finally {
        job.running -= 1;
      }
    }
  }

  private async fetchAndStore(
    job: CrawlJob,
    page: { url: string; depth: number },
    seedHost: string,
    config: DarkWebConfig
  ): Promise<void> {
    const result = await this.deps.fetcher.fetch(page.url, {
      mode: 'document',
      timeoutMs: Math.min(config.fetch.timeoutMs, 20_000),
      maxBytes: config.fetch.maxBytes,
      signal: job.abort.signal,
    });
    job.pagesFetched += 1;

    const mime = (result.contentType ?? '').split(';')[0].trim().toLowerCase();
    const html = result.text ?? '';
    const isHtml = mime === 'text/html' || (mime === '' && /^\s*<(?:!doctype|html)/i.test(html));

    if (config.storeLocalIndex) {
      const title = isHtml ? extractTitle(html) ?? page.url : null;
      const text = isHtml
        ? extractText(html, TEXT_MAX_BYTES)
        : (mime.startsWith('text/') || mime === 'application/json' ? html.slice(0, TEXT_MAX_BYTES) : '');
      if (text.trim().length > 0) {
        const added = await this.deps.index.add({
          url: result.finalUrl,
          host: seedHost,
          title: title ?? result.finalUrl,
          text,
          fetchedAt: this.now(),
          provider: null,
          crawlJobId: job.jobId,
        });
        if (added.added) job.docsAdded += 1;
        else if (added.reason === 'duplicate_content') job.docsDuplicate += 1;
      }
    }

    // Link discovery only from HTML pages, only under depth/page limits.
    if (isHtml && page.depth < job.maxDepth) {
      const links = extractLinks(html, result.finalUrl, 100);
      for (const link of links) {
        if (job.pagesFetched + job.pagesFailed + job.queue.length >= job.maxPages) break;
        const v = validateOnionFetchUrl(link.url);
        if (!v.valid) continue;
        if (job.sameHostOnly && v.hostname !== seedHost) continue;
        const key = canonical(v.url!);
        if (job.seen.has(key)) continue;
        job.seen.add(key);
        job.queue.push({ url: v.url!, depth: page.depth + 1 });
        job.pagesQueued += 1;
      }
    }
  }

  status(jobId: string): DarkWebCrawlStatus | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const { abort: _abort, seen: _seen, queue: _queue, running: _running, stopRequested: _stop, ...publicFields } = job;
    return { ...publicFields, pagesQueued: job.queue.length + job.pagesFetched };
  }

  listJobs(): DarkWebCrawlStatus[] {
    return [...this.jobs.keys()].map((id) => this.status(id)!).filter(Boolean);
  }

  /**
   * Cancel (spec §24): new requests stop immediately; in-flight fetches
   * abort (socket teardown); the job settles as CANCELLED when workers
   * drain.
   */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.endedAt !== null) return true;
    job.stopRequested = true;
    job.state = 'STOPPING';
    job.abort.abort();
    job.queue.length = 0;
    return true;
  }

  /** Abort everything (app shutdown). */
  cancelAll(): void {
    for (const job of this.jobs.values()) {
      if (job.endedAt === null) {
        job.stopRequested = true;
        job.abort.abort();
        job.queue.length = 0;
        job.state = 'CANCELLED';
        job.endedAt = this.now();
      }
    }
  }

  private pruneJobs(): void {
    for (const [id, job] of this.jobs) {
      if (job.endedAt !== null && this.now() - job.endedAt > 30 * 60_000) this.jobs.delete(id);
    }
  }
}

function clampInt(value: number | undefined, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : max;
  return Math.min(max, Math.max(min, n));
}

function canonical(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return `${u.host}${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`;
  } catch {
    return url;
  }
}

// Re-export for consumers that need the host check without importing pure.
export { isOnionHost };
