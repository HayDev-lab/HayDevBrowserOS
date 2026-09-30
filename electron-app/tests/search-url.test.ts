/**
 * getSearchUrl tests — configurable default search (Perplexica integration).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getSearchUrl } from '../src/main/browser/pure/url-utils';

const ENV_KEY = 'PAB_SEARCH_URL';
const original = process.env[ENV_KEY];

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe('getSearchUrl', () => {
  it('defaults to DuckDuckGo when PAB_SEARCH_URL is unset', () => {
    delete process.env[ENV_KEY];
    expect(getSearchUrl('electron browser')).toBe(
      'https://duckduckgo.com/?q=electron%20browser'
    );
  });

  it('substitutes %s in a Perplexica template', () => {
    process.env[ENV_KEY] = 'http://127.0.0.1:3000/?q=%s';
    expect(getSearchUrl('raycast vs alfred')).toBe(
      'http://127.0.0.1:3000/?q=raycast%20vs%20alfred'
    );
  });

  it('encodes special characters', () => {
    process.env[ENV_KEY] = 'http://127.0.0.1:3000/?q=%s';
    expect(getSearchUrl('c++ & rust?')).toBe(
      'http://127.0.0.1:3000/?q=c%2B%2B%20%26%20rust%3F'
    );
  });

  it('appends q= when the template has no %s and no q param', () => {
    process.env[ENV_KEY] = 'http://127.0.0.1:3000/search';
    expect(getSearchUrl('test')).toBe('http://127.0.0.1:3000/search?q=test');
  });
});
