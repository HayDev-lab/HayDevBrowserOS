/**
 * Dark Web Search subsystem — shared contracts.
 *
 * Pure data — no Electron/Node imports. Crossed boundaries:
 *   - main runtime (DarkWebService) ↔ pab://darkweb page (via the protocol
 *     handler's JSON mini-API)
 *   - main runtime ↔ local MCP server (darkweb_* tools)
 *   - TabState.isDarkWeb consumers (renderer chrome)
 *
 * SECURITY:
 *   - No secrets, no credentials, no raw page HTML crosses these types.
 *   - External page content is metadata + extracted text only, and is always
 *     labelled untrusted by the sender (see UNTRUSTED_CONTENT envelope in
 *     darkweb-service.ts).
 */

export type DarkWebProviderId = string;

export type ProviderRunStatus = 'ok' | 'error' | 'timeout' | 'disabled' | 'no_tor';

/** Per-provider outcome for one search execution. */
export interface DarkWebProviderReport {
  id: DarkWebProviderId;
  status: ProviderRunStatus;
  durationMs: number;
  resultCount: number;
  /** Safe error code (e.g. EXTERNAL_PROVIDER_UNAVAILABLE) — never a traceback. */
  errorCode: string | null;
}

export type Reachability = 'yes' | 'no' | 'unknown';

/** One merged search result (deduplicated across providers). */
export interface DarkWebSearchResult {
  id: string;
  title: string;
  url: string;
  hostname: string;
  snippet: string;
  /** Every provider that surfaced this URL — dedup confidence signal. */
  providers: DarkWebProviderId[];
  /** Aggregate ranking score (higher = better, see rank.ts weights). */
  score: number;
  reachable: Reachability;
  /** Epoch ms of the last availability check; null = never checked. */
  checkedAt: number | null;
  /** Provider-reported freshness (epoch ms) if known. */
  lastSeen: number | null;
}

export type SearchJobState = 'SEARCHING' | 'PARTIAL_RESULTS' | 'DONE' | 'ERROR' | 'CANCELLED';

/** Full search response — matches spec §62 shape plus job tracking fields. */
export interface DarkWebSearchResponse {
  searchId: string;
  query: string;
  state: SearchJobState;
  results: DarkWebSearchResult[];
  providers: Record<string, DarkWebProviderReport>;
  total: number;
  durationMs: number;
  /** Safe error code when state === 'ERROR'. */
  errorCode: string | null;
}

export type ProviderHealth = 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';

export interface DarkWebProviderStatus {
  id: DarkWebProviderId;
  name: string;
  enabled: boolean;
  /** True when the provider can only run while Tor is READY. */
  requiresTor: boolean;
  health: ProviderHealth;
  lastLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  /** Epoch ms until the circuit breaker re-probes; null when closed. */
  circuitOpenUntil: number | null;
}

export type TorState = 'NOT_INSTALLED' | 'STARTING' | 'READY' | 'OFFLINE' | 'ERROR';

export interface DarkWebTorStatus {
  state: TorState;
  socksHost: string;
  socksPort: number;
  /** Human-readable diagnostics (safe for UI — no internal paths in prod). */
  detail: string | null;
  latencyMs: number | null;
  lastCheckAt: number | null;
}

export type CrawlJobState =
  | 'QUEUED'
  | 'RUNNING'
  | 'DONE'
  | 'CANCELLED'
  | 'ERROR'
  | 'STOPPING';

export interface DarkWebCrawlStatus {
  jobId: string;
  seedUrl: string;
  state: CrawlJobState;
  maxDepth: number;
  maxPages: number;
  sameHostOnly: boolean;
  pagesFetched: number;
  pagesFailed: number;
  pagesQueued: number;
  docsAdded: number;
  docsDuplicate: number;
  startedAt: number;
  endedAt: number | null;
  errorCode: string | null;
}

/** A quarantined download from an onion tab (never auto-saved / auto-run). */
export interface DarkWebDownloadInfo {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  sourceUrl: string;
  receivedAt: number;
  state: 'QUARANTINED' | 'SAVED' | 'DISCARDED' | 'BLOCKED';
  /** Executable/archive-ish types — extra warning in the UI. */
  dangerous: boolean;
}

// ---------------------------------------------------------------------------
// Config — single source of all dark-web limits (spec §37/§38)
// ---------------------------------------------------------------------------

export interface DarkWebConfig {
  enabled: boolean;
  tor: {
    socksHost: string;
    socksPort: number;
    /** Spawn a detected tor binary when the SOCKS port is closed. */
    spawnIfAvailable: boolean;
    /** Explicit tor binary path override (env PAB_TOR_PATH wins). */
    binaryPath: string | null;
    /** Health probe target fetched THROUGH Tor (http onion, HEAD). */
    probeUrl: string;
    probeTimeoutMs: number;
  };
  search: {
    globalTimeoutMs: number;
    providerTimeoutMs: number;
    maxResults: number;
    /** Bounded availability re-check of result URLs through Tor. */
    availability: {
      enabled: boolean;
      maxUrls: number;
      concurrency: number;
      timeoutMs: number;
    };
    cacheTtlMs: number;
  };
  fetch: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
  };
  crawler: {
    maxDepth: number;
    maxPages: number;
    sameHostOnly: boolean;
    concurrency: number;
    timeoutMs: number;
  };
  providers: Record<string, { enabled: boolean }>;
  ranking: {
    providerCount: number;
    titleMatch: number;
    snippetMatch: number;
    urlMatch: number;
    reachable: number;
    freshness: number;
  };
  /** Persist search queries (query + providers + timestamp only). */
  storeSearchHistory: boolean;
  /** Persist crawled/fetched documents to the local index. */
  storeLocalIndex: boolean;
}

/** Fetch modes for the darkweb_fetch surface (spec §30). */
export type DarkWebFetchMode = 'text' | 'metadata';

/** Envelope handed to the AI/MCP consumer — content is UNTRUSTED data. */
export interface DarkWebFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  /** Extracted page text (mode=text) or null (mode=metadata). */
  text: string | null;
  title: string | null;
  bytes: number;
  durationMs: number;
  truncated: boolean;
  /** Explicit prompt-injection boundary marker (spec §44). */
  untrustedContent: true;
}

// ---------------------------------------------------------------------------
// Pab://darkweb mini-API payloads
// ---------------------------------------------------------------------------

export interface DarkWebSettingsPatch {
  enabled?: boolean;
  storeSearchHistory?: boolean;
  storeLocalIndex?: boolean;
  tor?: Partial<Pick<DarkWebConfig['tor'], 'socksHost' | 'socksPort' | 'spawnIfAvailable'>>;
  search?: Partial<Pick<DarkWebConfig['search'], 'globalTimeoutMs' | 'providerTimeoutMs' | 'maxResults'>>;
  crawler?: Partial<Pick<DarkWebConfig['crawler'], 'maxDepth' | 'maxPages' | 'sameHostOnly' | 'concurrency'>>;
  providers?: Record<string, { enabled: boolean }>;
}

/** Top-level UI status snapshot for the darkweb page. */
export interface DarkWebUiStatus {
  enabled: boolean;
  tor: DarkWebTorStatus;
  providers: DarkWebProviderStatus[];
  historyCount: number;
  indexCount: number;
}
