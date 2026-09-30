/**
 * Result normalization + deduplication (spec §7/§8).
 *
 * Provider-specific shapes arrive as RawProviderResult; they leave as
 * normalized entries and merge into ONE card per canonical URL with a
 * `providers[]` union — 4 engines finding the same onion produce ONE row
 * listing all four sources.
 *
 * PURE LOGIC — no electron, no node imports.
 */

export interface RawProviderResult {
  title: string;
  url: string;
  snippet: string;
  /** Epoch ms the engine last saw this page, if reported. */
  lastSeen?: number | null;
}

export interface NormalizedResult {
  title: string;
  url: string;
  hostname: string;
  snippet: string;
  provider: string;
  lastSeen: number | null;
  key: string;
}

const TITLE_MAX = 300;
const SNIPPET_MAX = 2000;

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeProviderResult(raw: RawProviderResult, provider: string): NormalizedResult | null {
  if (typeof raw?.url !== 'string') return null;
  let url = raw.url.trim();
  if (url.length === 0 || url.length > 2048) return null;
  // Ahmia's cite field carries the bare onion address without a scheme.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith('.onion')) return null;
  // Result URLs are metadata, not navigation targets — strip credentials if
  // a misbehaving engine echoes them.
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  const title = collapseWhitespace(String(raw.title ?? '')).slice(0, TITLE_MAX);
  const snippet = collapseWhitespace(String(raw.snippet ?? '')).slice(0, SNIPPET_MAX);
  const key = resultKey(parsed);
  if (key === null) return null;
  return {
    title,
    url: parsed.href,
    hostname,
    snippet,
    provider,
    lastSeen: typeof raw.lastSeen === 'number' && Number.isFinite(raw.lastSeen) ? raw.lastSeen : null,
    key,
  };
}

function resultKey(u: URL): string | null {
  // Keep in sync with canonicalResultKey() in onion-url.ts (test-covered).
  const params = [...u.searchParams.entries()].filter(
    ([k]) => !k.toLowerCase().startsWith('utm_')
  );
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const search = new URLSearchParams(params).toString();
  let path = u.pathname.replace(/\/+$/, '');
  if (path === '') path = '/';
  return `${u.host}${path}${search ? `?${search}` : ''}`;
}

export interface MergedResult {
  title: string;
  url: string;
  hostname: string;
  snippet: string;
  providers: string[];
  lastSeen: number | null;
  key: string;
}

/**
 * Merge normalized entries by canonical key. Longest title/snippet wins
 * (engines truncate differently); lastSeen = most recent report.
 */
export function mergeResults(entries: NormalizedResult[]): MergedResult[] {
  const byKey = new Map<string, MergedResult>();
  for (const e of entries) {
    const existing = byKey.get(e.key);
    if (!existing) {
      byKey.set(e.key, {
        title: e.title,
        url: e.url,
        hostname: e.hostname,
        snippet: e.snippet,
        providers: [e.provider],
        lastSeen: e.lastSeen,
        key: e.key,
      });
      continue;
    }
    if (!existing.providers.includes(e.provider)) existing.providers.push(e.provider);
    if (e.title.length > existing.title.length) existing.title = e.title;
    if (e.snippet.length > existing.snippet.length) existing.snippet = e.snippet;
    if (e.lastSeen !== null && (existing.lastSeen === null || e.lastSeen > existing.lastSeen)) {
      existing.lastSeen = e.lastSeen;
    }
  }
  return [...byKey.values()];
}
