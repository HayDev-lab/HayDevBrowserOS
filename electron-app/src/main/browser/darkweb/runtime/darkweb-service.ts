/**
 * DarkWebService — the facade for the whole dark-web subsystem.
 *
 * Owns: config load/save (FileStorageAdapter), TorRuntime, DarkWebFetcher,
 * provider registry (Ahmia + Tor66 registered here), ProviderHealthTracker,
 * DarkWebSearchService, DarkWebCrawlerService, local index + history.
 *
 * Consumers:
 *   - pab://darkweb mini-API (page UI)   — darkweb-pab-api.ts
 *   - local MCP server (darkweb_* tools) — mcp/runtime wiring
 *   - BrowserCore (dark-web tab sessions)— electron glue
 *
 * Logging (spec §40): provider, requestId-ish, duration, status, error
 * TYPE only. Never page content, never query strings of fetch URLs.
 */
import { validateDarkWebConfig, applySettingsPatch } from '../pure/darkweb-config';
import { ProviderHealthTracker } from '../pure/provider-health';
import { validateOnionFetchUrl } from '../pure/onion-url';
import { extractTitle, extractText, sanitizeForPreview } from '../pure/html-extract';
import { contentHash } from '../pure/content-hash';
import { SocksConnectError, probeSocks } from './socks-client';
import { DarkWebFetcher, DarkWebFetchError } from './fetcher';
import { TorRuntime } from './tor-runtime';
import {
  DarkWebProviderRegistry,
  AhmiaProvider,
  Tor66Provider,
  type ProviderFetchPort,
} from './providers';
import { DarkWebSearchService } from './search-service';
import { DarkWebCrawlerService } from './crawler';
import { DarkWebLocalIndex, DarkWebSearchHistory } from './local-index';
import type { StorageAdapter } from '../../storage/storage-adapter';
import type { SocksEndpoint } from './socks-client';
import type {
  DarkWebConfig,
  DarkWebFetchMode,
  DarkWebFetchResult,
  DarkWebProviderStatus,
  DarkWebSettingsPatch,
  DarkWebTorStatus,
  DarkWebUiStatus,
} from '@shared/darkweb-types';

export interface DarkWebServiceDeps {
  userDataDir: string;
  /** userData/darkweb/*.json stores. */
  configStorage: StorageAdapter;
  indexStorage: StorageAdapter;
  historyStorage: StorageAdapter;
  log?: (msg: string) => void;
}

const LOG_MAX = 180;

export class DarkWebService {
  private config: DarkWebConfig;
  readonly tor = new TorRuntime((m) => this.log(m));
  readonly fetcher: DarkWebFetcher;
  readonly registry = new DarkWebProviderRegistry();
  readonly health = new ProviderHealthTracker();
  readonly search: DarkWebSearchService;
  readonly crawler: DarkWebCrawlerService;
  readonly index: DarkWebLocalIndex;
  readonly history: DarkWebSearchHistory;

  private lastTorCheck = 0;
  private torCheckInflight: Promise<DarkWebTorStatus> | null = null;
  private readonly logFn: (msg: string) => void;
  /**
   * Managed Tor provider (HayDevRuntimeManager). When attached AND READY,
   * the subsystem uses its endpoint and skips its own probe/spawn — one
   * Tor process for the whole browser (spec §11 HayDevRuntimeManager).
   */
  private managedTor: { isReady(): boolean; endpoint(): { host: string; port: number } | null } | null = null;

  constructor(private readonly deps: DarkWebServiceDeps) {
    this.logFn = deps.log ?? ((m) => console.log(m));
    this.config = validateDarkWebConfig(null).config;
    this.fetcher = new DarkWebFetcher({
      getConfig: () => this.config,
      isTorReady: () => this.managedTor?.isReady() ?? this.tor.isReady(),
      socksEndpoint: () => this.managedTor?.endpoint() ?? this.socksEndpoint(),
    });
    const port: ProviderFetchPort = {
      fetchOnion: async (url, timeoutMs) => {
        const r = await this.fetcher.fetch(url, { mode: 'text', timeoutMs });
        return { status: r.status, contentType: r.contentType, text: r.text };
      },
      fetchClearnet: async (url, timeoutMs) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
        try {
          const resp = await fetch(url, {
            signal: controller.signal,
            headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36' },
            redirect: 'follow',
          });
          const contentType = resp.headers.get('content-type');
          const text = contentType?.includes('html') || contentType?.includes('text') || contentType?.includes('json')
            ? await resp.text()
            : null;
          return { status: resp.status, contentType, text: text?.slice(0, 2_000_000) ?? null };
        } finally {
          clearTimeout(timer);
        }
      },
      isTorReady: () => this.managedTor?.isReady() ?? this.tor.isReady(),
    };
    this.registry.register(new AhmiaProvider(port));
    this.registry.register(new Tor66Provider(port));
    this.index = new DarkWebLocalIndex(deps.indexStorage);
    this.history = new DarkWebSearchHistory(deps.historyStorage);
    this.search = new DarkWebSearchService({
      getConfig: () => this.config,
      registry: this.registry,
      fetcher: this.fetcher,
      health: this.health,
      history: this.history,
    });
    this.crawler = new DarkWebCrawlerService({
      getConfig: () => this.config,
      fetcher: this.fetcher,
      index: this.index,
    });
  }

  private log(msg: string): void {
    this.logFn(msg.slice(0, LOG_MAX));
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  getConfig(): DarkWebConfig {
    return this.config;
  }

  async loadConfig(): Promise<void> {
    let raw: unknown = null;
    try {
      const text = await this.deps.configStorage.read();
      if (text.trim().length > 0) raw = JSON.parse(text);
    } catch {
      raw = null; // corrupt config → defaults
    }
    const { config, errors } = validateDarkWebConfig(raw);
    this.config = config;
    if (errors.length > 0) this.log(`[darkweb] config clamped: ${errors.join('; ')}`);
    // Env overrides (documented in .env.example) — no secrets involved.
    const envPort = Number.parseInt(process.env.PAB_TOR_SOCKS_PORT ?? '', 10);
    if (Number.isInteger(envPort)) {
      this.config = { ...this.config, tor: { ...this.config.tor, socksPort: envPort } };
    }
    if (process.env.PAB_TOR_SOCKS_HOST?.trim()) {
      this.config = { ...this.config, tor: { ...this.config.tor, socksHost: process.env.PAB_TOR_SOCKS_HOST.trim() } };
    }
    await Promise.all([this.index.load(), this.history.load()]);
  }

  async updateSettings(patch: DarkWebSettingsPatch): Promise<DarkWebConfig> {
    this.config = applySettingsPatch(this.config, patch);
    try {
      await this.deps.configStorage.write(JSON.stringify(this.config));
    } catch (err) {
      this.log(`[darkweb] config persist failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    return this.config;
  }

  // ---------------------------------------------------------------------------
  // Tor status (cached probe; single flight)
  // ---------------------------------------------------------------------------

  socksEndpoint(): SocksEndpoint {
    return { host: this.config.tor.socksHost, port: this.config.tor.socksPort };
  }

  /** Attach the runtime manager's Tor (single managed process, spec §11). */
  attachManagedTor(provider: { isReady(): boolean; endpoint(): { host: string; port: number } | null }): void {
    this.managedTor = provider;
  }

  /** True when the runtime manager's Tor is the active gateway. */
  usesManagedTor(): boolean {
    return this.managedTor?.isReady() === true;
  }

  getManagedTorEndpoint(): { host: string; port: number } | null {
    return this.managedTor?.endpoint() ?? null;
  }

  async torStatus(force = false): Promise<DarkWebTorStatus> {
    const age = Date.now() - this.lastTorCheck;
    if (!force && this.tor.isReady() && age < 60_000) return this.tor.status(this.config);
    if (this.torCheckInflight) return this.torCheckInflight;
    this.lastTorCheck = Date.now();
    this.torCheckInflight = this.tor
      .ensureReady(this.config)
      .catch((err) => {
        this.log(`[darkweb] tor probe failed: ${err instanceof Error ? err.message : 'unknown'}`);
        return this.tor.status(this.config);
      })
      .finally(() => {
        this.torCheckInflight = null;
      });
    return this.torCheckInflight;
  }

  /** Quick SOCKS-endpoint reachability (no onion probe) for diagnostics. */
  async socksReachable(): Promise<boolean> {
    try {
      const r = await probeSocks({
        proxy: this.socksEndpoint(),
        probeHost: this.config.tor.probeUrl ? new URL(this.config.tor.probeUrl).hostname : 'x.onion',
        timeoutMs: 3_000,
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // UI status / providers
  // ---------------------------------------------------------------------------

  async uiStatus(): Promise<DarkWebUiStatus> {
    const tor = await this.torStatus();
    return {
      enabled: this.config.enabled,
      tor,
      providers: this.providerStatuses(),
      historyCount: (await this.history.list()).length,
      indexCount: await this.index.size(),
    };
  }

  providerStatuses(): DarkWebProviderStatus[] {
    return this.registry.list().map((p) => {
      const s = this.health.getStatus(p.id);
      return {
        id: p.id,
        name: p.name,
        enabled: this.config.providers[p.id]?.enabled === true,
        requiresTor: p.requiresTor,
        health: s.health,
        lastLatencyMs: s.lastLatencyMs,
        lastSuccessAt: s.lastSuccessAt,
        lastFailureAt: s.lastFailureAt,
        circuitOpenUntil: s.circuitOpenUntil,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Fetch / preview / index-add (page + MCP surface)
  // ---------------------------------------------------------------------------

  /**
   * Safe fetch (spec §30). mode='text' → extracted page text ONLY (never
   * raw HTML to an agent); mode='metadata' → headers/status only.
   * Content is always wrapped in the UNTRUSTED envelope (spec §43/§44).
   */
  async fetchPage(url: string, mode: DarkWebFetchMode = 'text'): Promise<DarkWebFetchResult> {
    const result = await this.fetcher.fetch(url, { mode });
    let text: string | null = null;
    let title: string | null = null;
    if (mode === 'text' && result.text !== null) {
      title = extractTitle(result.text);
      text = extractText(result.text, 20_000);
    }
    return {
      url,
      finalUrl: result.finalUrl,
      status: result.status,
      contentType: result.contentType,
      text,
      title,
      bytes: result.bytes,
      durationMs: result.durationMs,
      truncated: result.truncated,
      untrustedContent: true,
    };
  }

  /** Sanitized HTML preview for the darkweb page (double sandboxed there). */
  async fetchPreview(url: string): Promise<{ url: string; finalUrl: string; title: string | null; html: string; status: number; contentType: string | null }> {
    const result = await this.fetcher.fetch(url, { mode: 'document' });
    const html = sanitizeForPreview(result.text ?? '');
    return {
      url,
      finalUrl: result.finalUrl,
      title: extractTitle(result.text ?? ''),
      html,
      status: result.status,
      contentType: result.contentType,
    };
  }

  /** Fetch + store one page into the local index (spec §20 "Add to index"). */
  async indexPage(url: string, crawlJobId: string | null = null): Promise<{ added: boolean; reason: string | null }> {
    if (!this.config.storeLocalIndex) return { added: false, reason: 'index_disabled' };
    const result = await this.fetcher.fetch(url, { mode: 'document' });
    const text = extractText(result.text ?? '', TEXT_LIMIT);
    if (text.trim().length === 0) return { added: false, reason: 'empty_text' };
    const validated = validateOnionFetchUrl(result.finalUrl);
    const added = await this.index.add({
      url: result.finalUrl,
      host: validated.hostname ?? '',
      title: extractTitle(result.text ?? '') ?? result.finalUrl,
      text,
      fetchedAt: Date.now(),
      provider: null,
      crawlJobId,
    });
    this.log(`[darkweb] index add ${added.added ? 'ok' : `skipped:${added.reason}`} bytes=${result.bytes}`);
    return { added: added.added, reason: added.reason };
  }

  /** Explicit content-hash (exposed for tests / diagnostics). */
  hashContent(text: string): string {
    return contentHash(text);
  }

  // ---------------------------------------------------------------------------
  // Privacy controls (spec §41)
  // ---------------------------------------------------------------------------

  async clearSearchHistory(): Promise<void> {
    await this.history.clear();
  }

  async clearLocalIndex(): Promise<void> {
    await this.index.clear();
  }

  /**
   * Short-TTL search cache lives inside DarkWebSearchService (private);
   * retention is bounded by config.search.cacheTtlMs (default 10 min, max
   * 60 min). No user-specific payloads are cached — query + metadata only.
   */
  clearSearchCache(): void {
    // Intentional no-op: cache expiry is the clearing mechanism (spec §64
    // permits a short-TTL cache). Documented for the settings UI.
  }

  dispose(): void {
    this.crawler.cancelAll();
    this.tor.stop();
  }

  /**
   * The MCP-facing port (McpDarkWebPort). Search awaits the terminal job
   * state so MCP callers get ONE structured response (spec §29), unlike the
   * page which streams via polling.
   */
  mcpPort(): import('@shared/mcp-types').McpDarkWebPort {
    return {
      status: () => this.uiStatus(),
      providers: () => this.providerStatuses(),
      search: (request) =>
        this.search.search({
          query: request.query,
          providers: request.providers,
          limit: request.limit,
          timeoutMs: request.timeoutMs,
          wait: true,
        }),
      fetch: (url, mode) => this.fetchPage(url, mode),
      crawl: (request) =>
        this.crawler.crawl({
          url: request.url,
          maxDepth: request.maxDepth,
          maxPages: request.maxPages,
        }),
      crawlStatus: (jobId) => this.crawler.status(jobId),
      stopCrawl: (jobId) => this.crawler.cancel(jobId),
      searchLocalIndex: (query, limit) => this.index.search(query, limit ?? 20),
    };
  }
}

const TEXT_LIMIT = 200_000;

export { DarkWebFetchError, SocksConnectError };
