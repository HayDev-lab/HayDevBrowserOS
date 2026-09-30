/**
 * DarkWebFetcher — the ONLY way dark-web code touches an onion resource
 * (spec §13/§14/§32/§33/§57).
 *
 * Guarantees:
 *   - URL validated by the strict onion/SSRF validator BEFORE any socket,
 *     and re-validated on EVERY redirect hop (onion→clearnet and
 *     onion→private-IP redirects are blocked, never "helpfully" followed
 *     on clearnet — NO CLEARNET FALLBACK, fail-closed).
 *   - Requires an end-to-end READY Tor probe; otherwise throws
 *     TOR_UNAVAILABLE. A closed Tor NEVER degrades to a direct request.
 *   - Byte cap, header cap, timeout, redirect cap, no content-coding
 *     (decompression-bomb proof by construction).
 *   - MIME allowlist for document/text consumption: text/html, text/plain,
 *     application/json. Everything else is metadata-only — never
 *     auto-downloaded, never handed to a renderer.
 *
 * Transport (`httpOverSocks`) is injectable for tests.
 */
import { validateOnionFetchUrl } from '../pure/onion-url';
import { httpOverSocks, decodeBody, HttpOverSocksError } from './http-over-socks';
import type { SocksEndpoint } from './socks-client';
import type { DarkWebConfig } from '@shared/darkweb-types';

export class DarkWebFetchError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DarkWebFetchError';
  }
}

const ALLOWED_MIME_PREFIXES = ['text/html', 'text/plain', 'application/json'];

export interface FetchResult {
  status: number;
  contentType: string | null;
  /** Raw body (Buffer) for allowed MIME types; null otherwise / for HEAD. */
  body: Buffer | null;
  text: string | null;
  finalUrl: string;
  bytes: number;
  durationMs: number;
  truncated: boolean;
}

export interface FetcherDeps {
  getConfig: () => DarkWebConfig;
  /** End-to-end Tor readiness (probe-based). */
  isTorReady: () => boolean;
  socksEndpoint: () => SocksEndpoint;
  transport?: typeof httpOverSocks;
}

export class DarkWebFetcher {
  constructor(private readonly deps: FetcherDeps) {}

  /**
   * Fetch an onion URL. `mode='metadata'` issues a HEAD-equivalent (body
   * discarded); `mode='document'`/`'text'` enforce the MIME allowlist.
   */
  async fetch(
    rawUrl: string,
    opts: { mode?: 'document' | 'text' | 'metadata'; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {}
  ): Promise<FetchResult> {
    const config = this.deps.getConfig();
    // 1. FAIL-CLOSED gate #1: strict validation before anything else.
    const validated = validateOnionFetchUrl(rawUrl);
    if (!validated.valid) {
      throw new DarkWebFetchError(validated.reason ?? 'invalid_url', 'URL is not a fetchable onion resource');
    }
    // 2. FAIL-CLOSED gate #2: Tor must be provably usable right now.
    if (!this.deps.isTorReady()) {
      throw new DarkWebFetchError('TOR_UNAVAILABLE', 'Tor is offline — onion fetch refused (no clearnet fallback)');
    }
    const mode = opts.mode ?? 'document';
    const timeoutMs = opts.timeoutMs ?? config.fetch.timeoutMs;
    const maxBytes = opts.maxBytes ?? config.fetch.maxBytes;

    const started = Date.now();
    try {
      const result = await (this.deps.transport ?? httpOverSocks)({
        proxy: this.deps.socksEndpoint(),
        method: mode === 'metadata' ? 'HEAD' : 'GET',
        url: validated.url!,
        timeoutMs,
        maxBytes,
        maxRedirects: config.fetch.maxRedirects,
        signal: opts.signal,
        // 3. FAIL-CLOSED gate #3: every redirect hop re-validated. The
        // validator REJECTS non-onion targets, so an onion→clearnet
        // redirect cannot silently leave the Tor path.
        validateUrl: (u) => {
          const v = validateOnionFetchUrl(u);
          if (!v.valid) {
            throw new HttpOverSocksError(v.reason ?? 'redirect_blocked', `redirect target blocked: ${v.reason}`);
          }
          return v.url!;
        },
      });

      const contentType = result.headers['content-type'] ?? null;
      const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
      // MIME allowlist (spec §13) for successful document/text reads: only
      // text/html, text/plain, application/json are consumed. Unknown MIME
      // on a success status is NOT auto-consumed; error pages (>=400) are
      // still readable because error text is what the user needs to see.
      const mimeAllowed = ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
      const bodyAllowed = mode !== 'metadata' && (result.status >= 400 || mime === '' || mimeAllowed);
      const body = result.body && bodyAllowed ? result.body : null;
      const text = body ? decodeBody(body, contentType) : null;

      return {
        status: result.status,
        contentType,
        body,
        text,
        finalUrl: result.finalUrl,
        bytes: result.bytesReceived,
        durationMs: Date.now() - started,
        truncated: result.bytesReceived >= maxBytes,
      };
    } catch (err) {
      if (err instanceof DarkWebFetchError) throw err;
      if (err instanceof HttpOverSocksError) {
        const code = err.code === 'socks_rep_4' || err.code === 'onion_unreachable'
          ? 'ONION_UNREACHABLE'
          : mapTransportCode(err.code);
        throw new DarkWebFetchError(code, err.message);
      }
      throw new DarkWebFetchError('FETCH_FAILED', err instanceof Error ? err.message : 'fetch failed');
    }
  }

  /**
   * Availability probe: bounded-time metadata fetch. Returns reachability
   * verdict, never throws.
   */
  async checkReachable(rawUrl: string, timeoutMs: number): Promise<{ reachable: boolean; checkedAt: number; errorCode: string | null }> {
    const checkedAt = Date.now();
    try {
      const r = await this.fetch(rawUrl, { mode: 'metadata', timeoutMs });
      return { reachable: r.status < 500, checkedAt, errorCode: null };
    } catch (err) {
      return {
        reachable: false,
        checkedAt,
        errorCode: err instanceof DarkWebFetchError ? err.code : 'CHECK_FAILED',
      };
    }
  }
}

function mapTransportCode(code: string): string {
  switch (code) {
    case 'timeout': return 'FETCH_TIMEOUT';
    case 'response_too_large': return 'RESPONSE_TOO_LARGE';
    case 'too_many_redirects': return 'TOO_MANY_REDIRECTS';
    case 'redirect_loop': return 'REDIRECT_LOOP';
    case 'header_too_large': return 'RESPONSE_TOO_LARGE';
    case 'aborted': return 'FETCH_ABORTED';
    case 'proxy_unreachable': return 'TOR_UNAVAILABLE';
    case 'bad_redirect': return 'REDIRECT_BLOCKED';
    default: return `FETCH_${code.toUpperCase()}`;
  }
}
