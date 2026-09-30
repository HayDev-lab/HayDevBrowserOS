/**
 * Ahmia.fi search-result parsing — pure functions mirroring the verified
 * PyAhmia implementation (github.com/rly0nheart/pyahmia, MIT):
 *
 *   endpoint   https://ahmia.fi/search/?q=<query>[&d=<1|7|30>][&<token>]
 *   token      hidden <input type="hidden" name value> scraped from the
 *              homepage, cached ~10 min (anti-bot form field)
 *   results    <li class="result">
 *                <h4> title
 *                <p>  description
 *                <cite> bare onion address (no scheme)
 *                <span class="lastSeen" data-timestamp="…">
 *
 * The fetch itself lives in runtime/providers/ahmia.ts (clearnet via
 * global fetch, or the onion variant routed through the Tor gateway).
 *
 * PURE LOGIC — no electron, no node imports.
 */
import type { RawProviderResult } from './normalize';

export interface AhmiaToken {
  name: string;
  value: string;
  scrapedAt: number;
}

/** Extract the hidden anti-bot token from an Ahmia homepage HTML. */
export function parseAhmiaToken(homepageHtml: string): AhmiaToken | null {
  const m = /<input[^>]*type\s*=\s*("hidden"|'hidden'|hidden)[^>]*>/i.exec(homepageHtml);
  if (!m) return null;
  const tag = m[0];
  const name = /\sname\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  const value = /\svalue\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  const nameVal = (name?.[2] ?? name?.[3] ?? name?.[4] ?? '').trim();
  const valueVal = (value?.[2] ?? value?.[3] ?? value?.[4] ?? '').trim();
  if (nameVal.length === 0) return null;
  return { name: nameVal, value: valueVal, scrapedAt: Date.now() };
}

function unescapeAhmia(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ') // tag content → text (BeautifulSoup .text semantics)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse an Ahmia search results page. Returns raw entries in document
 * order; normalization/dedup happens upstream. Page-level bot checks
 * (CAPTCHA pages) simply parse to zero results — the caller treats that
 * as an empty page, not an error.
 */
export function parseAhmiaResults(html: string): RawProviderResult[] {
  const out: RawProviderResult[] = [];
  const liRe = /<li\b[^>]*class\s*=\s*("[^"]*result[^"]*"|'[^']*result[^']*')[^>]*>([\s\S]*?)<\/li\s*>/gi;
  let li: RegExpExecArray | null;
  while ((li = liRe.exec(html)) !== null) {
    const block = li[2];
    const titleM = /<h4[^>]*>([\s\S]*?)<\/h4\s*>/i.exec(block);
    const descM = /<p[^>]*>([\s\S]*?)<\/p\s*>/i.exec(block);
    const citeM = /<cite[^>]*>([\s\S]*?)<\/cite\s*>/i.exec(block);
    const seenM = /<span[^>]*class\s*=\s*("[^"]*lastSeen[^"]*"|'[^']*lastSeen[^']*')[^>]*>([\s\S]*?)<\/span\s*>/i.exec(block);
    const tsM = /data-timestamp\s*=\s*("([^"]*)"|'([^']*)')/i.exec(seenM?.[0] ?? block);
    const url = unescapeAhmia(citeM?.[1] ?? '');
    if (url.length === 0) continue;
    const tsRaw = tsM?.[2] ?? tsM?.[3];
    const lastSeen = tsRaw && /^\d{10,16}$/.test(tsRaw) ? Number(tsRaw) : null;
    out.push({
      title: unescapeAhmia(titleM?.[1] ?? ''),
      url,
      snippet: unescapeAhmia((descM?.[1] ?? '').replace(/<[^>]+>/g, ' ')),
      lastSeen: lastSeen !== null && lastSeen < 10_000_000_000 ? lastSeen * 1000 : lastSeen,
    });
  }
  return out;
}

/** Build the search URL from parts (kept pure for tests). */
export function buildAhmiaSearchUrl(baseUrl: string, query: string, token: AhmiaToken | null, periodDays: 1 | 7 | 30 | null): string {
  const u = new URL('/search', baseUrl);
  u.searchParams.set('q', query);
  if (periodDays !== null) u.searchParams.set('d', String(periodDays));
  if (token) u.searchParams.set(token.name, token.value);
  return u.href;
}
