/**
 * URL utilities for the Browser Core.
 *
 * PURE LOGIC — no `electron`, no `node:*` imports. Safe to unit-test in any
 * runtime.
 *
 * Rules:
 *   - `http`, `https`, `about:blank`, `file://` (local) are navigable.
 *   - Bare hostnames (`example.com`) are upgraded to `https://example.com`.
 *   - Anything that looks like a search query (contains spaces, or has no
 *     dot in the first path segment) is sent to a search URL.
 *   - `javascript:`, `data:`, `vbscript:`, `blob:` from address bar are
 *     ALWAYS rejected (security — never let a user paste script URLs).
 */

/**
 * Default search URL. Configurable via PAB_SEARCH_URL (main-process env,
 * loaded from .env) — used to point the address-bar search at a local
 * Perplexica instance: `PAB_SEARCH_URL=http://127.0.0.1:3000/?q=%s`.
 * The template may contain `%s` (replaced with the encoded query);
 * otherwise the query is appended as a `q=` parameter.
 */
export function getSearchUrl(query: string): string {
  // AI-search mode: a local Perplexica instance turns the query into a
  // full answered page served by our own pab://search internal page.
  if (process.env.PAB_PERPLEXICA_URL?.trim()) {
    return `pab://search?q=${encodeURIComponent(query)}`;
  }
  const template =
    process.env.PAB_SEARCH_URL?.trim() || 'https://duckduckgo.com/?q=';
  const encoded = encodeURIComponent(query);
  if (template.includes('%s')) {
    return template.replace('%s', encoded);
  }
  if (/[?&]q=$/.test(template)) {
    return template + encoded;
  }
  return template + (template.includes('?') ? '&' : '?') + 'q=' + encoded;
}

const ALLOWED_PROTOCOLS = new Set([
  'http:',
  'https:',
  'about:',
  'pab:',
  'file:',
]);

const BLOCKED_PROTOCOLS_FROM_ADDRESS_BAR = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'blob:',
  'file:',
]);

export interface NormalizedUrl {
  /** The URL string to actually load, or null if the input is rejected. */
  url: string | null;
  /** Why the input was rejected, when `url === null`. */
  reason: string | null;
  /** If the input was treated as a search query, this is the search URL. */
  isSearch: boolean;
  /** The raw input as typed by the user. */
  raw: string;
}

/**
 * Validate an absolute URL string.
 */
export function isValidUrl(input: string): boolean {
  if (typeof input !== 'string' || input.length === 0) return false;
  try {
    const u = new URL(input);
    return ALLOWED_PROTOCOLS.has(u.protocol);
  } catch {
    return false;
  }
}

/**
 * Returns true if the URL is safe to load FROM THE ADDRESS BAR.
 *
 * Address-bar inputs have stricter rules than programmatic navigation:
 * `file:` and `javascript:` and `data:` are blocked.
 */
export function isAddressBarSafe(input: string): boolean {
  if (typeof input !== 'string' || input.length === 0) return false;
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;

  try {
    const u = new URL(trimmed);
    if (BLOCKED_PROTOCOLS_FROM_ADDRESS_BAR.has(u.protocol)) {
      return false;
    }
    return ALLOWED_PROTOCOLS.has(u.protocol);
  } catch {
    // Not a parseable URL — that's fine, it might be a search query.
    return true;
  }
}

/**
 * Heuristic: does this string look like a search query (rather than a URL)?
 *
 *   - Contains whitespace anywhere → search.
 *   - No `.` in the first segment before `/` → search.
 *   - Starts with a known protocol that parses → URL.
 */
export function looksLikeSearchQuery(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;

  // Already a valid URL with an allowed protocol → not a search.
  try {
    const u = new URL(trimmed);
    if (ALLOWED_PROTOCOLS.has(u.protocol)) return false;
  } catch {
    // fall through to heuristic
  }

  // Contains whitespace → search.
  if (/\s/.test(trimmed)) return true;

  // Extract the host portion (before the first `/`).
  const firstSlash = trimmed.indexOf('/');
  const hostPart = firstSlash === -1 ? trimmed : trimmed.slice(0, firstSlash);

  // No `.` in host → treat as search.
  if (!hostPart.includes('.')) return true;

  return false;
}

/**
 * Normalize a raw address-bar input into a URL that is safe to navigate to.
 *
 * Returns `{ url: null, reason: '...' }` for rejected inputs.
 */
export function normalizeAddressBarInput(raw: string): NormalizedUrl {
  const trimmed = (raw ?? '').trim();
  const result: NormalizedUrl = {
    url: null,
    reason: null,
    isSearch: false,
    raw,
  };

  if (trimmed.length === 0) {
    result.reason = 'empty';
    return result;
  }

  // Step 1 — try as URL.
  try {
    const u = new URL(trimmed);
    if (BLOCKED_PROTOCOLS_FROM_ADDRESS_BAR.has(u.protocol)) {
      result.reason = `blocked_protocol:${u.protocol}`;
      return result;
    }
    if (ALLOWED_PROTOCOLS.has(u.protocol)) {
      result.url = u.href;
      return result;
    }
    // Unknown protocol → search (e.g. "spotify:track" is treated as a query).
  } catch {
    // Not a parseable URL — continue to heuristic.
  }

  // Step 2 — search query?
  if (looksLikeSearchQuery(trimmed)) {
    result.isSearch = true;
    result.url = getSearchUrl(trimmed);
    return result;
  }

  // Step 3 — bare hostname upgrade.
  const upgraded = `https://${trimmed}`;
  try {
    const u = new URL(upgraded);
    if (ALLOWED_PROTOCOLS.has(u.protocol)) {
      result.url = u.href;
      return result;
    }
  } catch {
    // fall through
  }

  result.reason = 'unparseable';
  return result;
}

/**
 * Pretty-print a URL for display in the address bar.
 * Strips trailing slash for the root of a host (`https://x.com/` → `https://x.com`).
 */
export function prettyUrl(input: string): string {
  try {
    const u = new URL(input);
    if (u.pathname === '/' && u.search === '' && u.hash === '') {
      return `${u.protocol}//${u.host}`;
    }
    return u.href;
  } catch {
    return input;
  }
}

/**
 * Returns the registrable host of a URL for display purposes
 * (e.g. `https://news.example.com/article` → `news.example.com`).
 */
export function hostOf(input: string): string | null {
  try {
    const u = new URL(input);
    return u.host || null;
  } catch {
    return null;
  }
}

/**
 * Strip URL of fragments and query for history deduplication.
 */
export function canonicalizeForHistory(input: string): string {
  try {
    const u = new URL(input);
    u.hash = '';
    return u.href;
  } catch {
    return input;
  }
}
