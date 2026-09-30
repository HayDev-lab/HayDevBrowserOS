/**
 * URL canonicalization for source deduplication — pure logic.
 *
 * Minimal, deliberately conservative (NOT a crawler URL framework):
 *   - trim whitespace;
 *   - lowercase scheme + hostname;
 *   - drop the fragment (#…);
 *   - default port removed (:80/:443);
 *   - root path "/" collapses to "" (example.com/ === example.com);
 *   - path/query/search ARE preserved — explicitly different pages stay
 *     different (no aggressive merging without evidence).
 *
 * Returns the input unchanged (trimmed) when it cannot be parsed as a URL —
 * unparseable strings are never silently equated with each other.
 */
export function canonicalizeResearchUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    const port =
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
        ? ''
        : u.port ? `:${u.port}` : '';
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.protocol.toLowerCase()}//${host}${port}${path}${u.search}`;
  } catch {
    return trimmed;
  }
}

/** True when two raw URLs canonicalize to the same source. */
export function isSameResearchUrl(a: string, b: string): boolean {
  return canonicalizeResearchUrl(a) === canonicalizeResearchUrl(b);
}
