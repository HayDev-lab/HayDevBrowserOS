/**
 * Domain matcher — pure logic (no electron, no node:crypto).
 *
 * Canonicalizes domain strings and performs domain-bound matching for the
 * credential vault. This is the security boundary that prevents:
 *
 *   - `evil-example.com` matching stored `example.com`
 *   - `example.com.attacker.net` matching stored `example.com`
 *   - Naive `hostname.includes(domain)` attacks
 *
 * Matching rules:
 *   - Exact match: `example.com` matches stored `example.com`.
 *   - Subdomain match: `login.example.com` matches stored `example.com`
 *     (the stored domain is a parent of the page domain).
 *   - Reverse subdomain: stored `login.example.com` does NOT match page
 *     `example.com` (the stored domain is more specific than the page).
 *   - Malicious suffix: `evil-example.com` does NOT match stored `example.com`.
 *   - Casing: domains are case-insensitive (lowercased before comparison).
 *   - Ports: stripped before comparison.
 *   - Invalid URLs/domains: rejected (returns null canonical form).
 */
import { VAULT_BOUNDS } from '@shared/vault-types';

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

export interface CanonicalDomainResult {
  /** The canonical (lowercased, port-stripped) domain, or null if invalid. */
  domain: string | null;
  /** Reason for rejection, if domain is null. */
  reason: string | null;
}

/**
 * Canonicalize a domain string from a URL or bare hostname.
 *
 * Accepts:
 *   - Full URLs: `https://login.example.com:8080/path` → `login.example.com`
 *   - Bare hostnames: `example.com` → `example.com`
 *   - With ports: `example.com:443` → `example.com`
 *
 * Rejects:
 *   - Empty strings
 *   - IP addresses (not domain names)
 *   - localhost (not a real domain for vault purposes)
 *   - about:blank, file:, javascript:, data:, blob:
 *   - Domains exceeding MAX_DOMAIN_LENGTH (253 chars)
 */
export function canonicalizeDomain(input: string): CanonicalDomainResult {
  if (typeof input !== 'string' || input.length === 0) {
    return { domain: null, reason: 'empty_input' };
  }

  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) {
    return { domain: null, reason: 'empty_after_trim' };
  }

  if (trimmed.length > VAULT_BOUNDS.MAX_DOMAIN_LENGTH) {
    return { domain: null, reason: 'too_long' };
  }

  // Try parsing as URL first.
  let hostname: string;
  try {
    // If it doesn't have a protocol, prepend https:// for URL parsing.
    const urlStr = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const u = new URL(urlStr);

    // Reject non-http(s) protocols.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { domain: null, reason: `blocked_protocol:${u.protocol}` };
    }

    hostname = u.hostname;
  } catch {
    return { domain: null, reason: 'unparseable' };
  }

  if (!hostname || hostname.length === 0) {
    return { domain: null, reason: 'empty_hostname' };
  }

  // Reject IP addresses.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return { domain: null, reason: 'ip_address_not_allowed' };
  }

  // Reject localhost.
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { domain: null, reason: 'localhost_not_allowed' };
  }

  // Must have at least one dot (e.g. "example.com").
  if (!hostname.includes('.')) {
    return { domain: null, reason: 'no_dot_in_domain' };
  }

  // Validate each label (alphanumeric + hyphen, no leading/trailing hyphen).
  const labels = hostname.split('.');
  for (const label of labels) {
    if (label.length === 0) {
      return { domain: null, reason: 'empty_label' };
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { domain: null, reason: `invalid_label:${label}` };
    }
  }

  return { domain: hostname, reason: null };
}

// ---------------------------------------------------------------------------
// Domain matching
// ---------------------------------------------------------------------------

export interface DomainMatchResult {
  matched: boolean;
  /** The canonical page domain. */
  pageDomain: string | null;
  /** The canonical stored domain. */
  storedDomain: string;
  /** Reason for non-match (if !matched). */
  reason: string | null;
}

/**
 * Check if a page domain matches a stored domain.
 *
 * Rules:
 *   - Exact match: pageDomain === storedDomain → matched.
 *   - Subdomain match: pageDomain ends with `.storedDomain` → matched.
 *     (e.g. page `login.example.com` matches stored `example.com`).
 *   - Reverse subdomain: storedDomain ends with `.pageDomain` → NOT matched.
 *     (e.g. page `example.com` does NOT match stored `login.example.com` —
 *     the stored domain is more specific).
 *   - Malicious suffix: `evil-example.com` does NOT match `example.com`.
 *     (The `.storedDomain` prefix check prevents this.)
 *
 * Both inputs are canonicalized before comparison. If the page domain
 * cannot be canonicalized (invalid URL), the match fails.
 */
export function matchDomain(
  pageUrlOrHost: string,
  storedDomain: string
): DomainMatchResult {
  const pageResult = canonicalizeDomain(pageUrlOrHost);
  const storedResult = canonicalizeDomain(storedDomain);

  if (pageResult.domain === null) {
    return {
      matched: false,
      pageDomain: null,
      storedDomain: storedResult.domain ?? storedDomain,
      reason: `page_domain_invalid:${pageResult.reason}`,
    };
  }

  if (storedResult.domain === null) {
    return {
      matched: false,
      pageDomain: pageResult.domain,
      storedDomain,
      reason: `stored_domain_invalid:${storedResult.reason}`,
    };
  }

  const page = pageResult.domain;
  const stored = storedResult.domain;

  // Exact match.
  if (page === stored) {
    return { matched: true, pageDomain: page, storedDomain: stored, reason: null };
  }

  // Subdomain match: page ends with `.storedDomain`.
  // This ensures `login.example.com` matches `example.com` but
  // `evil-example.com` does NOT match `example.com` (because the
  // suffix check is `.example.com`, not `example.com`).
  if (page.endsWith(`.${stored}`)) {
    return { matched: true, pageDomain: page, storedDomain: stored, reason: null };
  }

  return {
    matched: false,
    pageDomain: page,
    storedDomain: stored,
    reason: 'domain_mismatch',
  };
}

/**
 * Convenience: check if a page domain matches any stored domain.
 * Returns the matched stored domain, or null if no match.
 */
export function findMatchingDomain(
  pageUrlOrHost: string,
  storedDomains: string[]
): string | null {
  for (const stored of storedDomains) {
    const result = matchDomain(pageUrlOrHost, stored);
    if (result.matched) return stored;
  }
  return null;
}
