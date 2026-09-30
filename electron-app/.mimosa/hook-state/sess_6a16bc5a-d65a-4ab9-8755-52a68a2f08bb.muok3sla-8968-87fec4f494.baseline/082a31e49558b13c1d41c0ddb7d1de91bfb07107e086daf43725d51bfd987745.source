/**
 * Content hash for local-index deduplication (spec §27).
 *
 * Pure, dependency-free FNV-1a 64-bit over normalized text — a page saved
 * twice with the same normalized content collapses to one document.
 *
 * PURE LOGIC — no electron, no node imports.
 */

export function normalizeTextForHash(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 64-bit FNV-1a as 16-char hex (uses BigInt for the 2^64 space). */
export function contentHash(text: string): string {
  const normalized = normalizeTextForHash(text);
  let hash = 0xcbf29ce484222325n; // FNV offset basis
  const prime = 0x100000001b3n;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= BigInt(normalized.charCodeAt(i) & 0xff);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}
