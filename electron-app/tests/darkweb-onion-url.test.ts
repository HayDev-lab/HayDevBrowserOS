/**
 * Onion URL validation — security tests (spec §32/§33/§55/§56).
 * Every rejected class here is a SSRF / leak / script-execution vector.
 */
import { describe, it, expect } from 'vitest';
import {
  validateOnionFetchUrl,
  isOnionHost,
  isValidOnionV3Host,
  isOnionV2Host,
  isPrivateOrReservedHost,
  canonicalResultKey,
} from '../src/main/browser/darkweb/pure/onion-url';

const V3 = 'g2zyg5nldclustersnothisisfake56base32charsaa'; // placeholder — real ones below
const ONION_V3 = 'juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion';
void V3;

describe('onion hostname recognition', () => {
  it('accepts a v3 onion host (56 base32 chars)', () => {
    expect(isOnionHost(ONION_V3)).toBe(true);
    expect(isValidOnionV3Host(ONION_V3)).toBe(true);
  });

  it('rejects v2 (16 chars) — deprecated, fail-closed', () => {
    expect(isOnionV2Host('xxxxxxxxxxxxxxxx.onion')).toBe(true);
    expect(isValidOnionV3Host('xxxxxxxxxxxxxxxx.onion')).toBe(false);
    expect(validateOnionFetchUrl('http://xxxxxxxxxxxxxxxx.onion/').reason).toBe('onion_v2_deprecated');
  });

  it('rejects wrong-length labels and non-base32 chars', () => {
    expect(isValidOnionV3Host('abc.onion')).toBe(false);
    expect(isValidOnionV3Host(`${'a'.repeat(55)}.onion`)).toBe(false);
    expect(isValidOnionV3Host(`${'a'.repeat(57)}.onion`)).toBe(false);
    // 0, 1, 8, 9 are not base32
    expect(isValidOnionV3Host(`${'0'.repeat(56)}.onion`)).toBe(false);
  });

  it('accepts subdomain.onion forms by validating the registered label', () => {
    expect(isValidOnionV3Host(`www.${ONION_V3}`)).toBe(true);
  });
});

describe('validateOnionFetchUrl — protocols (spec §32)', () => {
  it('allows http and https onion URLs', () => {
    expect(validateOnionFetchUrl(`http://${ONION_V3}/a`).valid).toBe(true);
    expect(validateOnionFetchUrl(`https://${ONION_V3}/a`).valid).toBe(true);
  });

  it('blocks javascript:, file:, data:, ftp:, about:', () => {
    for (const p of ['javascript:', 'file:', 'data:', 'ftp:', 'about:']) {
      const r = validateOnionFetchUrl(`javascript:alert(1)`.replace('javascript:', p));
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/blocked_protocol|unsupported_protocol/);
    }
  });

  it('blocks clearnet hosts — the fetch surface is onion-only', () => {
    expect(validateOnionFetchUrl('https://example.com/').reason).toBe('not_onion_host');
  });
});

describe('validateOnionFetchUrl — SSRF / local targets (spec §33)', () => {
  it('blocks loopback, private ranges, link-local, metadata endpoints', () => {
    const bad = [
      'http://127.0.0.1:9050/',
      'http://10.0.0.1/',
      'http://172.16.0.5/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://localhost/',
      'http://localhost:8080/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://2130706433/', // decimal IPv4 for 127.0.0.1
      'http://0x7f000001/', // hex IPv4
    ];
    for (const u of bad) {
      const r = validateOnionFetchUrl(u);
      expect(r.valid, u).toBe(false);
      expect(r.reason, u).toBe('private_or_local_target');
    }
  });

  it('rejects userinfo tricks', () => {
    expect(validateOnionFetchUrl(`http://user:pass@${ONION_V3}/`).reason).toBe('userinfo_not_allowed');
  });

  it('rejects unparseable and oversized inputs', () => {
    expect(validateOnionFetchUrl('').reason).toBe('empty_url');
    expect(validateOnionFetchUrl('not a url \\ > <').reason).toBe('unparseable_url');
    expect(validateOnionFetchUrl(`http://${ONION_V3}/${'a'.repeat(3000)}`).reason).toBe('url_too_long');
  });
});

describe('isPrivateOrReservedHost (defense in depth)', () => {
  it('flags private hosts even before the onion rule runs', () => {
    expect(isPrivateOrReservedHost('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('192.168.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('localhost')).toBe(true);
    expect(isPrivateOrReservedHost('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedHost('[::1]')).toBe(true);
    expect(isPrivateOrReservedHost('example.com')).toBe(false);
  });
});

describe('redirect-hop validation (spec §11 — no clearnet fallback)', () => {
  it('a redirect to clearnet is REJECTED, not followed', () => {
    expect(validateOnionFetchUrl('https://example.com/').valid).toBe(false);
  });
  it('a redirect to a private IP is REJECTED', () => {
    expect(validateOnionFetchUrl('http://192.168.0.44/').valid).toBe(false);
  });
  it('a redirect to another v3 onion is allowed', () => {
    expect(validateOnionFetchUrl(`http://${'a'.repeat(56)}.onion/x`).valid).toBe(true);
  });
});

describe('canonicalResultKey (spec §8 dedup key)', () => {
  it('ignores trailing slash, fragments and utm params', () => {
    const a = canonicalResultKey(`http://${ONION_V3}/page/?utm_source=x&id=2#frag`);
    const b = canonicalResultKey(`http://${ONION_V3}/page?id=2`);
    expect(a).toBe(b);
  });

  it('keeps query order canonical', () => {
    const a = canonicalResultKey(`http://${ONION_V3}/s?b=1&a=2`);
    const b = canonicalResultKey(`http://${ONION_V3}/s?a=2&b=1`);
    expect(a).toBe(b);
  });

  it('treats different paths as different results', () => {
    expect(canonicalResultKey(`http://${ONION_V3}/a`)).not.toBe(canonicalResultKey(`http://${ONION_V3}/b`));
  });
});
