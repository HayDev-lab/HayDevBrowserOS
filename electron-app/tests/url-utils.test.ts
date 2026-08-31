import { describe, it, expect } from 'vitest';
import {
  isValidUrl,
  isAddressBarSafe,
  looksLikeSearchQuery,
  normalizeAddressBarInput,
  prettyUrl,
  hostOf,
  canonicalizeForHistory,
} from '../src/main/browser/pure/url-utils';

describe('url-utils / isValidUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
    expect(isValidUrl('https://example.com/path?q=1')).toBe(true);
  });
  it('accepts about:blank', () => {
    expect(isValidUrl('about:blank')).toBe(true);
  });
  it('rejects javascript: URLs', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
  });
  it('rejects bare strings', () => {
    expect(isValidUrl('example.com')).toBe(false);
    expect(isValidUrl('hello world')).toBe(false);
    expect(isValidUrl('')).toBe(false);
  });
});

describe('url-utils / isAddressBarSafe', () => {
  it('allows bare hostnames (treated as search-or-upgrade)', () => {
    expect(isAddressBarSafe('example.com')).toBe(true);
  });
  it('blocks javascript: from the address bar', () => {
    expect(isAddressBarSafe('javascript:alert(document.cookie)')).toBe(false);
  });
  it('blocks data: from the address bar', () => {
    expect(isAddressBarSafe('data:text/html,<script>fetch("/x")</script>')).toBe(false);
  });
  it('blocks file: from the address bar', () => {
    expect(isAddressBarSafe('file:///etc/passwd')).toBe(false);
  });
  it('allows https URLs', () => {
    expect(isAddressBarSafe('https://example.com/path')).toBe(true);
  });
  it('rejects empty input', () => {
    expect(isAddressBarSafe('')).toBe(false);
    expect(isAddressBarSafe('   ')).toBe(false);
  });
});

describe('url-utils / looksLikeSearchQuery', () => {
  it('returns false for parseable http(s) URLs', () => {
    expect(looksLikeSearchQuery('https://example.com')).toBe(false);
  });
  it('returns true for input with whitespace', () => {
    expect(looksLikeSearchQuery('best rust web framework')).toBe(true);
  });
  it('returns true for input with no dot in host segment', () => {
    expect(looksLikeSearchQuery('localhost')).toBe(true);
    expect(looksLikeSearchQuery('rust')).toBe(true);
  });
  it('returns false for bare hostnames with a dot', () => {
    expect(looksLikeSearchQuery('example.com')).toBe(false);
    expect(looksLikeSearchQuery('news.ycombinator.com')).toBe(false);
  });
});

describe('url-utils / normalizeAddressBarInput', () => {
  it('upgrades bare hostname to https', () => {
    const r = normalizeAddressBarInput('example.com');
    expect(r.url).toBe('https://example.com/');
    expect(r.isSearch).toBe(false);
    expect(r.reason).toBeNull();
  });
  it('treats multi-word input as a search query', () => {
    const r = normalizeAddressBarInput('best rust web framework');
    expect(r.isSearch).toBe(true);
    expect(r.url).toContain('duckduckgo.com');
    expect(r.url).toContain('best%20rust');
  });
  it('passes through valid https URLs', () => {
    const r = normalizeAddressBarInput('https://news.ycombinator.com/item?id=1');
    expect(r.url).toBe('https://news.ycombinator.com/item?id=1');
    expect(r.isSearch).toBe(false);
  });
  it('blocks javascript: URLs with a reason', () => {
    const r = normalizeAddressBarInput('javascript:alert(1)');
    expect(r.url).toBeNull();
    expect(r.reason).toBe('blocked_protocol:javascript:');
  });
  it('blocks file: URLs from the address bar', () => {
    const r = normalizeAddressBarInput('file:///etc/passwd');
    expect(r.url).toBeNull();
    expect(r.reason).toBe('blocked_protocol:file:');
  });
  it('returns reason "empty" for blank input', () => {
    const r = normalizeAddressBarInput('   ');
    expect(r.url).toBeNull();
    expect(r.reason).toBe('empty');
  });
  it('preserves the raw input', () => {
    const r = normalizeAddressBarInput('  example.com  ');
    expect(r.raw).toBe('  example.com  ');
  });
});

describe('url-utils / prettyUrl', () => {
  it('strips trailing slash on root paths', () => {
    expect(prettyUrl('https://example.com/')).toBe('https://example.com');
  });
  it('keeps full URL with path', () => {
    expect(prettyUrl('https://example.com/path?q=1#hash')).toBe(
      'https://example.com/path?q=1#hash'
    );
  });
  it('passes through unparseable input unchanged', () => {
    expect(prettyUrl('not a url')).toBe('not a url');
  });
});

describe('url-utils / hostOf', () => {
  it('returns the host for a URL', () => {
    expect(hostOf('https://news.example.com/article')).toBe(
      'news.example.com'
    );
  });
  it('returns null for non-URL input', () => {
    expect(hostOf('not a url')).toBeNull();
  });
});

describe('url-utils / canonicalizeForHistory', () => {
  it('strips the hash fragment', () => {
    expect(canonicalizeForHistory('https://example.com/a#section')).toBe(
      'https://example.com/a'
    );
  });
  it('preserves the query string', () => {
    expect(canonicalizeForHistory('https://example.com/a?x=1#y')).toBe(
      'https://example.com/a?x=1'
    );
  });
  it('passes through unparseable input unchanged', () => {
    expect(canonicalizeForHistory('not a url')).toBe('not a url');
  });
});
