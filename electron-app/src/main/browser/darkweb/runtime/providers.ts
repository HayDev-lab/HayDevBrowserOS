/**
 * Dark-web search provider adapters (spec §6 — pluggable, never
 * hard-coupled).
 *
 *   DarkWebProvider (interface)
 *     ├─ AhmiaProvider — ahmia.fi (clearnet gateway; the exact provider
 *     │                 PyAhmia wraps). Works WITHOUT Tor; optionally
 *     │                 routed through the onion mirror when Tor is READY.
 *     ├─ Tor66Provider — onion-only engine, fetches through the Tor gateway.
 *     └─ (future: Robin subprocess adapter, DarknetMcp adapter — the
 *        registry interface is their only integration point; NOT bundled.)
 *
 * A provider receives a `port` for fetching so it never touches sockets
 * directly and stays unit-testable with fakes.
 */
import {
  parseAhmiaResults,
  parseAhmiaToken,
  buildAhmiaSearchUrl,
  type AhmiaToken,
} from '../pure/ahmia-parser';
import { parseTor66Results } from '../pure/tor66-parser';
import type { RawProviderResult } from '../pure/normalize';

/** Fetch port a provider may use (both fetch and plain clearnet GET). */
export interface ProviderFetchPort {
  /** GET through the Tor gateway; throws DarkWebFetchError. */
  fetchOnion(url: string, timeoutMs: number): Promise<{ status: number; contentType: string | null; text: string | null }>;
  /** Plain clearnet GET (global fetch) for clearnet gateways like ahmia.fi. */
  fetchClearnet(url: string, timeoutMs: number): Promise<{ status: number; contentType: string | null; text: string | null }>;
  /** Whether the Tor gateway is READY (drives ahmia onion routing). */
  isTorReady(): boolean;
}

export interface DarkWebProvider {
  readonly id: string;
  readonly name: string;
  readonly requiresTor: boolean;
  search(query: string, opts: { limit: number; timeoutMs: number; signal?: AbortSignal }): Promise<RawProviderResult[]>;
}

// ---------------------------------------------------------------------------
// Ahmia
// ---------------------------------------------------------------------------

export const AHMIA_CLEARNET_BASE = 'https://ahmia.fi';
/** Official Ahmia onion mirror (verified from the pyahmia source). */
export const AHMIA_ONION_BASE = 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion';

const TOKEN_TTL_MS = 600_000; // pyahmia caches the token for 10 minutes

export class AhmiaProvider implements DarkWebProvider {
  readonly id = 'ahmia';
  readonly name = 'Ahmia';
  readonly requiresTor = false;
  private token: AhmiaToken | null = null;

  constructor(private readonly port: ProviderFetchPort) {}

  async search(query: string, opts: { limit: number; timeoutMs: number }): Promise<RawProviderResult[]> {
    const useTor = this.port.isTorReady();
    const base = useTor ? AHMIA_ONION_BASE : AHMIA_CLEARNET_BASE;

    // 1. Anti-bot token from the homepage (per-site variant, cached).
    const token = await this.ensureToken(base, opts.timeoutMs);

    // 2. Search request.
    const url = buildAhmiaSearchUrl(base, query, token, null);
    const resp = useTor
      ? await this.port.fetchOnion(url, opts.timeoutMs)
      : await this.port.fetchClearnet(url, opts.timeoutMs);
    if (resp.status >= 400) {
      throw new Error(`EXTERNAL_PROVIDER_UNAVAILABLE: ahmia responded ${resp.status}`);
    }
    const html = resp.text ?? '';
    // 3. Parse — a CAPTCHA/bot page parses to zero results.
    return parseAhmiaResults(html).slice(0, opts.limit);
  }

  private async ensureToken(base: string, timeoutMs: number): Promise<AhmiaToken | null> {
    if (this.token && Date.now() - this.token.scrapedAt < TOKEN_TTL_MS) return this.token;
    try {
      const home = base === AHMIA_ONION_BASE
        ? await this.port.fetchOnion(base + '/', timeoutMs)
        : await this.port.fetchClearnet(base + '/', timeoutMs);
      if (home.status < 400 && home.text) {
        this.token = parseAhmiaToken(home.text);
      }
    } catch {
      // Homepage fetch failure is not fatal — search may still work
      // without the token; a 403 will surface as provider error then.
      this.token = null;
    }
    return this.token;
  }
}

// ---------------------------------------------------------------------------
// Tor66 (onion-only; requires the Tor gateway)
// ---------------------------------------------------------------------------

export const TOR66_ONION_BASE =
  // v3 onion, verified live through the managed Tor SOCKS gateway
  // (2026-10-01): the previously listed ...uohhyl3qcyyeiafkliegvfiogiijd
  // address is 55 base32 chars — tor rejects it as an invalid hostname.
  'http://tor66sewebgixwhcqfnp5inzp5x5uohhdy3kvtnyfxc2e5mxiuh34iid.onion';

export class Tor66Provider implements DarkWebProvider {
  readonly id = 'tor66';
  readonly name = 'Tor66';
  readonly requiresTor = true;

  constructor(private readonly port: ProviderFetchPort) {}

  async search(query: string, opts: { limit: number; timeoutMs: number }): Promise<RawProviderResult[]> {
    if (!this.port.isTorReady()) {
      throw new Error('NO_TOR: tor66 requires an online Tor gateway');
    }
    const u = new URL('/search', TOR66_ONION_BASE);
    u.searchParams.set('q', query);
    const resp = await this.port.fetchOnion(u.href, opts.timeoutMs);
    if (resp.status >= 400) {
      throw new Error(`EXTERNAL_PROVIDER_UNAVAILABLE: tor66 responded ${resp.status}`);
    }
    return parseTor66Results(resp.text ?? '').slice(0, opts.limit);
  }
}

// ---------------------------------------------------------------------------
// Registry (spec §69)
// ---------------------------------------------------------------------------

export class DarkWebProviderRegistry {
  private readonly providers = new Map<string, DarkWebProvider>();

  register(provider: DarkWebProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  get(id: string): DarkWebProvider | null {
    return this.providers.get(id) ?? null;
  }

  /** Providers enabled by config, in a stable registration order. */
  getEnabled(isEnabled: (id: string) => boolean): DarkWebProvider[] {
    return [...this.providers.values()].filter((p) => isEnabled(p.id));
  }

  list(): DarkWebProvider[] {
    return [...this.providers.values()];
  }
}
