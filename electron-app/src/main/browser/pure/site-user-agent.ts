/**
 * Site-facing User-Agent — pure token cleanup.
 *
 * Electron's default UA advertises the embedding shell:
 *   ... PersonalAgenticBrowser/0.1.0 Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36
 *
 * Sites gate on the browser FAMILY parsed from the UA (WhatsApp: "Chrome 100+
 * required" — it parses the UA, sees "Electron"/an unknown product, and
 * rejects). The engine tokens already state a real, current Chromium version,
 * so we present the engine only: shell tokens are removed, engine version
 * stays HONEST (no version spoofing).
 *
 * Pure — no Electron imports.
 */

/** Product tokens of the embedding shell, hidden from sites. */
const SHELL_TOKENS = [
  /(?:^|\s)PersonalAgenticBrowser\/[\d.]+/,
  /(?:^|\s)Electron\/[\d.]+/,
];

export function buildSiteUserAgent(rawUA: string): string {
  if (typeof rawUA !== 'string' || rawUA.length === 0) return rawUA ?? '';
  let ua = rawUA;
  for (const token of SHELL_TOKENS) {
    ua = ua.replace(token, '');
  }
  // Collapse double spaces left by removed tokens.
  return ua.replace(/\s{2,}/g, ' ').trim();
}
