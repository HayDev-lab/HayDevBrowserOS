/**
 * Onion URL validation — the SECURITY GATE of the dark-web fetch surface.
 *
 * PURE LOGIC — no electron, no node imports. Unit-tested heavily
 * (tests/darkweb-onion-url.test.ts).
 *
 * Policy (spec §32/§33/§57 — FAIL CLOSED):
 *   - Only http: and https: with a valid .onion hostname are fetchable.
 *   - file:, ftp:, javascript:, data:, blob:, about: … are rejected.
 *   - Loopback / private / link-local / cloud-metadata targets are rejected
 *     even when they arrive dressed as hostnames (defense in depth — the
 *     .onion-only rule already excludes them).
 *   - onion v3 hostnames only (56 base32 chars); v2 (16 chars) is rejected —
 *     the network deprecated it and accepting it would be fail-open.
 *   - userinfo (user:pass@) is rejected — credentials never belong in a
 *     fetch URL and are a common SSRF/confusion trick.
 */

const ONION_SUFFIX = '.onion';
/** onion v3: 56 chars of base32 (a-z, 2-7). */
const V3_LABEL = /^[a-z2-7]{56}$/;
/** Legacy onion v2 — rejected by default (deprecated, truncation-prone). */
const V2_LABEL = /^[a-z2-7]{16}$/;

export interface OnionUrlValidation {
  valid: boolean;
  /** Machine-readable reason when invalid (safe to show in diagnostics). */
  reason: string | null;
  /** Normalized URL (lowercased host, no hash) when valid. */
  url: string | null;
  hostname: string | null;
}

function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function ipv4ToInt(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function ipv4IsPrivate(value: number): boolean {
  return (
    value === 0 || // 0.0.0.0/8
    (value >= 0x0a000000 && value <= 0x0affffff) || // 10/8
    (value >= 0x7f000000 && value <= 0x7fffffff) || // 127/8
    (value >= 0xa9fe0000 && value <= 0xa9feffff) || // 169.254/16 (link-local, cloud metadata)
    (value >= 0xac100000 && value <= 0xac1fffff) || // 172.16/12
    (value >= 0xc0000000 && value <= 0xcfffffff) || // 192.168/16 + 192.0/2 residual
    (value >= 0xc0586300 && value <= 0xc05863ff) || // 192.0.2.0/24 (doc)
    (value >= 0xc6120000 && value <= 0xc63fffff) || // 198.18/15
    (value >= 0xc6336400 && value <= 0xc63367ff) || // 198.51.100.0/24 (doc)
    (value >= 0xcb007100 && value <= 0xcb0071ff) // 203.0.113.0/24 (doc)
  );
}

function isPrivateIpv6Literal(host: string): boolean {
  // Normalized bracket-stripped lower-case literal.
  if (!host.includes(':')) return false;
  const h = host.replace(/^\[|\]$/g, '');
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 unique-local
  if (h.startsWith('::ffff:')) {
    const v4 = h.slice(7);
    if (isIpv4Literal(v4)) {
      const v = ipv4ToInt(v4);
      return v !== null && ipv4IsPrivate(v);
    }
  }
  return false;
}

/**
 * True when the host string is a loopback / private / link-local /
 * cloud-metadata style target. Applied to the literal host text BEFORE the
 * .onion rule — a string like `169.254.169.254` must never pass even if
 * some future code path forgets the onion check.
 */
export function isPrivateOrReservedHost(host: string): boolean {
  const h = (host ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h.length === 0) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h === 'localhost.localdomain') return true;
  if (h === 'metadata.google.internal' || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (isIpv4Literal(h)) {
    const v = ipv4ToInt(h);
    return v === null || ipv4IsPrivate(v);
  }
  // Decimal / octal / hex IPv4 trickery (e.g. 2130706433, 0x7f000001).
  if (/^(0x[0-9a-f]+|\d+)$/.test(h)) return true;
  if (/^0\d{7,}$/.test(h)) return true;
  return isPrivateIpv6Literal(h);
}

export function isOnionHost(host: string): boolean {
  const h = (host ?? '').toLowerCase();
  return h.endsWith(ONION_SUFFIX) && h.length > ONION_SUFFIX.length;
}

/**
 * Valid onion v3 hostname (56 base32 chars before .onion; port ignored).
 * v2 (16 chars) is deliberately rejected — see module docstring.
 */
export function isValidOnionV3Host(host: string): boolean {
  const h = (host ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!isOnionHost(h)) return false;
  const label = h.slice(0, -ONION_SUFFIX.length);
  if (label.includes('.')) {
    // subdomain.onion-address — Tor routes the registered name only; treat
    // subdomain forms by validating the last label.
    const parts = label.split('.');
    return V3_LABEL.test(parts[parts.length - 1]);
  }
  return V3_LABEL.test(label);
}

export function isOnionV2Host(host: string): boolean {
  const h = (host ?? '').toLowerCase();
  if (!isOnionHost(h)) return false;
  return V2_LABEL.test(h.slice(0, -ONION_SUFFIX.length));
}

const FETCHABLE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Validate a URL for the dark-web fetch surface. Strictly .onion http(s).
 * Used for the seed URL AND for every redirect hop (fail-closed, spec §11:
 * an onion → clearnet redirect must be blocked, not followed on clearnet).
 */
export function validateOnionFetchUrl(raw: string): OnionUrlValidation {
  const fail = (reason: string): OnionUrlValidation => ({
    valid: false,
    reason,
    url: null,
    hostname: null,
  });

  if (typeof raw !== 'string' || raw.trim().length === 0) return fail('empty_url');
  if (raw.length > 2048) return fail('url_too_long');

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return fail('unparseable_url');
  }

  const protocol = parsed.protocol.toLowerCase();
  const dangerous = ['javascript:', 'data:', 'vbscript:', 'blob:', 'file:', 'ftp:', 'about:'];
  if (dangerous.includes(protocol)) return fail(`blocked_protocol:${protocol}`);
  if (!FETCHABLE_PROTOCOLS.has(protocol)) return fail(`unsupported_protocol:${protocol}`);

  const host = parsed.hostname.toLowerCase();
  if (isPrivateOrReservedHost(host)) return fail('private_or_local_target');
  if (parsed.username || parsed.password) return fail('userinfo_not_allowed');
  if (!isOnionHost(host)) return fail('not_onion_host');
  if (isOnionV2Host(host)) return fail('onion_v2_deprecated');
  if (!isValidOnionV3Host(host)) return fail('invalid_onion_hostname');

  const port = parsed.port === '' ? null : Number(parsed.port);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    return fail('invalid_port');
  }

  // Drop the fragment — it never travels on the wire and only pollutes keys.
  parsed.hash = '';
  return { valid: true, reason: null, url: parsed.href, hostname: host };
}

/**
 * Canonical dedup key for a result URL (spec §8): lowercase onion host +
 * normalized path (no trailing slash except root) + sorted query params,
 * fragments and utm_* trackers dropped.
 */
export function canonicalResultKey(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    const params = [...u.searchParams.entries()].filter(
      ([k]) => !k.toLowerCase().startsWith('utm_')
    );
    params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
    u.search = '';
    for (const [k, v] of params) u.searchParams.append(k, v);
    let path = u.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    return `${u.host}${path}${u.search}`;
  } catch {
    return null;
  }
}
