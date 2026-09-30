/**
 * HTML extraction + sanitization for fetched onion documents (spec §13/§17).
 *
 * PURE, regex-based — no DOM required (unit tests run in plain node).
 * The sanitizer output is ALSO rendered inside a sandboxed iframe by the
 * darkweb page (defence in depth: sanitize AND sandbox, scripts blocked
 * twice).
 *
 * Extraction limits are caller-supplied — this module never invents caps.
 */

const BLOCK_TAGS =
  /<(script|iframe|object|embed|applet|style|noscript|svg|form|input|button|select|textarea|template)\b[\s\S]*?<\/\1\s*>/gi;
const SELF_CLOSING_BLOCK = /<(script|iframe|object|embed|applet|input|img|meta|link|template)\b[^>]*\/?>/gi;
const EVENT_ATTR = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /\s(href|src|action|formaction)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]*)/gi;
const DANGEROUS_URL = /\s(href|src|action|formaction)\s*=\s*("data:[^"]*"|'data:[^']*')/gi;
const COMMENT = /<!--[\s\S]*?-->/g;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function decodeEntities(text: string): string {
  let out = text;
  for (const [ent, ch] of Object.entries(ENTITIES)) {
    out = out.split(ent).join(ch);
  }
  out = out.replace(/&#(\d{1,7});/g, (_, dec) => {
    const code = Number(dec);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
  return out;
}

/** Extract <title> content (decoded, whitespace-collapsed, length-capped). */
export function extractTitle(html: string, maxLen = 300): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!m) return null;
  const text = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, maxLen) : null;
}

/** Extract visible text: drop non-content blocks, strip tags, decode. */
export function extractText(html: string, maxLen: number): string {
  let s = html.replace(COMMENT, '');
  s = s.replace(BLOCK_TAGS, ' ');
  s = s.replace(SELF_CLOSING_BLOCK, ' ');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)\s*>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s).replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n').replace(/( *\n *)+/g, '\n').trim();
  return s.slice(0, Math.max(0, maxLen));
}

export interface ExtractedLink {
  url: string;
  text: string;
}

/**
 * Extract same-document <a href> links resolved against baseUrl. Only
 * http(s) survives; everything else (javascript:, data:, mailto:, …) is
 * dropped — crawler candidates come from here.
 */
export function extractLinks(html: string, baseUrl: string, cap: number): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const seen = new Set<string>();
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return out;
  }
  const re = /<a\b[^>]*?\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < cap) {
    const href = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (href.length === 0 || href.startsWith('#')) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    resolved.hash = '';
    const key = resolved.href;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = decodeEntities(m[5].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    out.push({ url: key, text: text.slice(0, 200) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Preview sanitizer (allowlist renderer)
// ---------------------------------------------------------------------------

/** Tags kept in sanitized preview output. */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'b', 'strong', 'i', 'em', 'u', 's',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a',
]);

/**
 * Reduce fetched HTML to an allowlisted, script-free fragment:
 *   - every tag not in ALLOWED_TAGS is unwrapped (content kept) or dropped;
 *   - ALL attributes are dropped except a[href] with http(s) URLs;
 *   - inline event handlers / javascript: / data: URLs cannot survive
 *     because no attribute other than href passes at all.
 *
 * Returns a fragment (no <html>/<head>/<body>) safe to embed via srcdoc +
 * sandbox="" and to innerHTML — belt and braces.
 */
export function sanitizeForPreview(html: string, maxLen = 200_000): string {
  let s = html.replace(COMMENT, '').slice(0, maxLen);
  // Drop head-content entirely.
  s = s.replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ');
  // Active/unsafe content disappears WITH its body — a <script>'s source
  // text must not survive as page text (spec §17: remove script etc.).
  s = s.replace(/<(script|style|iframe|object|embed|applet|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<(script|iframe|object|embed|applet|input|img|meta|link|template)\b[^>]*\/?>/gi, ' ');
  // Tokenize tags; escape everything that is not a kept tag.
  const tokens: string[] = [];
  let last = 0;
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(s)) !== null) {
    if (m.index > last) tokens.push(escapeHtmlText(s.slice(last, m.index)));
    const raw = m[0];
    const tagName = m[1].toLowerCase();
    const isClosing = raw.startsWith('</');
    if (ALLOWED_TAGS.has(tagName)) {
      if (tagName === 'a' && !isClosing) {
        const href = /\shref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[2] ?? '');
        const hrefVal = (href?.[2] ?? href?.[3] ?? '').trim();
        let safeHref: string | null = null;
        try {
          const u = new URL(hrefVal, 'http://x.invalid');
          if ((u.protocol === 'http:' || u.protocol === 'https:') && hrefVal) {
            safeHref = u.href;
          }
        } catch {
          safeHref = null;
        }
        tokens.push(safeHref ? `<a href="${escapeAttr(safeHref)}" rel="noreferrer noopener">` : '<a>');
      } else {
        tokens.push(isClosing ? `</${tagName}>` : `<${tagName}>`);
      }
    }
    // Non-allowed tags: drop the tag entirely (content preserved).
    last = tagRe.lastIndex;
  }
  if (last < s.length) tokens.push(escapeHtmlText(s.slice(last)));
  return tokens.join('');
}

export function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
