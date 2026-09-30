/**
 * Tor66 search-result parsing (pure).
 *
 * Tor66 (http://tor66sewebgixwhcqfnp5inzp5x5uohhdy3kvtnyfxc2e5mxiuh34iid.onion)
 * is an onion-only engine; the parser is written defensively because its
 * markup has no published schema: result links are <a> tags whose href is
 * a bare .onion address or http(s) .onion URL, with the surrounding text
 * as the title. Verification against the live service requires a running
 * Tor gateway (see worklog: NOT_VERIFIED_LIVE).
 *
 * PURE LOGIC — no electron, no node imports.
 */
import type { RawProviderResult } from './normalize';

const ONION_RE = /(?:https?:\/\/)?([a-z2-7]{56}\.onion)/gi;

/**
 * Parse a Tor66 results page. Strategy:
 *   1. anchor pass — anchors whose href references a 56-char onion host
 *      become results (title = anchor text, fallback = the host);
 *   2. for anchors without a snippet we leave snippet empty — the merge
 *      step prefers longer text from other engines.
 * Non-result navigational links (to the engine itself, /search pages,
 * category pages) are filtered by path depth.
 */
export function parseTor66Results(html: string): RawProviderResult[] {
  const out: RawProviderResult[] = [];
  const seen = new Set<string>();
  const aRe = /<a\b[^>]*?\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(html)) !== null) {
    const href = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!href) continue;
    ONION_RE.lastIndex = 0;
    const hostMatch = ONION_RE.exec(href);
    if (!hostMatch) continue;
    // Skip internal navigation (search/category/next pages on the engine host).
    if (href.toLowerCase().startsWith('http') && /\/(search|category|submit|about)/i.test(href)) continue;
    const url = href.toLowerCase().startsWith('http') ? href : `http://${hostMatch[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const title = m[5].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({
      title: (title || hostMatch[1]).slice(0, 300),
      url,
      snippet: '',
      lastSeen: null,
    });
  }
  return out;
}
