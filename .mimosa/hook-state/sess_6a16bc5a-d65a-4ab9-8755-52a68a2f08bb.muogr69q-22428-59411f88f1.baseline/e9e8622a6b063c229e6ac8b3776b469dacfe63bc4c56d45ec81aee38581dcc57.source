import { describe, it, expect } from 'vitest';
import {
  canonicalizeDomain,
  matchDomain,
  findMatchingDomain,
} from '../src/main/browser/vault/pure/domain-matcher';

// ===========================================================================
// Canonicalization
// ===========================================================================
describe('domain-matcher / canonicalizeDomain', () => {
  it('canonicalizes a bare hostname (lowercased)', () => {
    expect(canonicalizeDomain('Example.COM').domain).toBe('example.com');
  });

  it('canonicalizes a full URL (strips protocol, path, port)', () => {
    expect(canonicalizeDomain('https://login.example.com:8080/path?q=1').domain).toBe('login.example.com');
  });

  it('strips port from bare hostname', () => {
    expect(canonicalizeDomain('example.com:443').domain).toBe('example.com');
  });

  it('rejects empty input', () => {
    expect(canonicalizeDomain('').domain).toBeNull();
    expect(canonicalizeDomain('   ').domain).toBeNull();
  });

  it('rejects IP addresses', () => {
    expect(canonicalizeDomain('192.168.1.1').domain).toBeNull();
    expect(canonicalizeDomain('https://10.0.0.1/').domain).toBeNull();
  });

  it('rejects localhost', () => {
    expect(canonicalizeDomain('localhost').domain).toBeNull();
    expect(canonicalizeDomain('sub.localhost').domain).toBeNull();
  });

  it('rejects non-http protocols', () => {
    expect(canonicalizeDomain('javascript:alert(1)').domain).toBeNull();
    expect(canonicalizeDomain('file:///etc/passwd').domain).toBeNull();
    expect(canonicalizeDomain('about:blank').domain).toBeNull();
  });

  it('rejects domains without a dot', () => {
    expect(canonicalizeDomain('intranet').domain).toBeNull();
  });

  it('rejects domains with invalid labels', () => {
    expect(canonicalizeDomain('-example.com').domain).toBeNull();
    expect(canonicalizeDomain('example-.com').domain).toBeNull();
  });

  it('rejects excessively long domains', () => {
    const long = 'a'.repeat(260) + '.com';
    expect(canonicalizeDomain(long).domain).toBeNull();
  });
});

// ===========================================================================
// Domain matching
// ===========================================================================
describe('domain-matcher / matchDomain', () => {
  it('matches exact domain', () => {
    const r = matchDomain('https://example.com/', 'example.com');
    expect(r.matched).toBe(true);
  });

  it('matches subdomain (login.example.com → example.com)', () => {
    const r = matchDomain('https://login.example.com/', 'example.com');
    expect(r.matched).toBe(true);
  });

  it('matches deeper subdomain (a.b.example.com → example.com)', () => {
    const r = matchDomain('https://a.b.example.com/', 'example.com');
    expect(r.matched).toBe(true);
  });

  it('does NOT match evil-example.com (malicious suffix)', () => {
    const r = matchDomain('https://evil-example.com/', 'example.com');
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('domain_mismatch');
  });

  it('does NOT match example.com.attacker.net (malicious parent)', () => {
    const r = matchDomain('https://example.com.attacker.net/', 'example.com');
    expect(r.matched).toBe(false);
  });

  it('does NOT match reverse subdomain (example.com → login.example.com)', () => {
    const r = matchDomain('https://example.com/', 'login.example.com');
    expect(r.matched).toBe(false);
  });

  it('is case-insensitive', () => {
    const r1 = matchDomain('https://EXAMPLE.COM/', 'example.com');
    expect(r1.matched).toBe(true);
    const r2 = matchDomain('https://example.com/', 'EXAMPLE.COM');
    expect(r2.matched).toBe(true);
  });

  it('ignores ports', () => {
    const r = matchDomain('https://example.com:8443/', 'example.com');
    expect(r.matched).toBe(true);
  });

  it('rejects invalid page URL', () => {
    const r = matchDomain('javascript:alert(1)', 'example.com');
    expect(r.matched).toBe(false);
    expect(r.reason).toContain('page_domain_invalid');
  });

  it('rejects invalid stored domain', () => {
    const r = matchDomain('https://example.com/', 'localhost');
    expect(r.matched).toBe(false);
    expect(r.reason).toContain('stored_domain_invalid');
  });

  it('does NOT match unrelated domains', () => {
    const r = matchDomain('https://google.com/', 'example.com');
    expect(r.matched).toBe(false);
  });

  it('does NOT match when stored domain is a suffix without dot', () => {
    // `notexample.com` should NOT match `example.com`
    const r = matchDomain('https://notexample.com/', 'example.com');
    expect(r.matched).toBe(false);
  });
});

// ===========================================================================
// findMatchingDomain
// ===========================================================================
describe('domain-matcher / findMatchingDomain', () => {
  it('finds the exact match among multiple stored domains', () => {
    const stored = ['google.com', 'example.com', 'github.com'];
    expect(findMatchingDomain('https://example.com/', stored)).toBe('example.com');
  });

  it('finds a subdomain match', () => {
    const stored = ['google.com', 'example.com'];
    expect(findMatchingDomain('https://login.example.com/', stored)).toBe('example.com');
  });

  it('returns null when no domain matches', () => {
    const stored = ['google.com', 'github.com'];
    expect(findMatchingDomain('https://example.com/', stored)).toBeNull();
  });

  it('returns the first match (not a later one)', () => {
    const stored = ['example.com', 'login.example.com'];
    // Both match `https://login.example.com/` — should return the first.
    expect(findMatchingDomain('https://login.example.com/', stored)).toBe('example.com');
  });
});
