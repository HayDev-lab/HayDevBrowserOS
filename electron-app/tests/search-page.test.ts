/**
 * HayDev Search page (pab://search) + Perplexica mode tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildSearchPageHtml } from '../src/main/browser/pure/search-page';
import { getSearchUrl } from '../src/main/browser/pure/url-utils';

const ENV = 'PAB_PERPLEXICA_URL';
const original = process.env[ENV];

afterEach(() => {
  if (original === undefined) delete process.env[ENV];
  else process.env[ENV] = original;
});

describe('buildSearchPageHtml', () => {
  const html = buildSearchPageHtml({
    perplexicaURL: 'http://127.0.0.1:3000',
    modelKey: 'deepseek-v4-pro:0813',
  });

  it('embeds the API base and model key', () => {
    expect(html).toContain('"http://127.0.0.1:3000"');
    expect(html).toContain('deepseek-v4-pro:0813');
  });

  it('posts to the Perplexica search API with mode-driven sources', () => {
    expect(html).toContain("'/api/search'");
    expect(html).toContain('SOURCES_FOR_MODE(mode)');
    // Real Perplexica SearchSources values wired to the switcher.
    expect(html).toContain("source: 'discussions'");
    expect(html).toContain("source: 'academic'");
  });

  it('hosts the search mode switcher above the chat', () => {
    expect(html).toContain('id="modes"');
    expect(html).toContain("id: 'discussions', label: 'Discussions'");
    expect(html).toContain("id: 'academic', label: 'Academic'");
    // Dark Web routes through the Tor-gated page via the backend searchNavigate
    // bridge (falls back to a plain pab:// href) with the current query.
    expect(html).toContain("searchNavigate('darkweb', '?q=' + encodeURIComponent(dq))");
    // Deep Research via the scoped bridge, feature-detected.
    expect(html).toContain('__pabNewTab');
    expect(html).toContain('bridge.runResearch({ query: rq, attachmentIds: [] })');
    // Mode re-runs the query through pab://search with a src marker.
    expect(html).toContain("pabNav('search', '?q=' + encodeURIComponent(cur) + '&src=' + encodeURIComponent(id))");
  });

  it('is a CHAT page: keeps multi-turn history and appends turns', () => {
    expect(html).toContain("var history = []");
    expect(html).toContain('history.push([q, j.message');
    expect(html).toContain("id=\"chat\"");
  });

  it('has an in-page query form (search lives on the page, not just the address bar)', () => {
    expect(html).toContain('id="form"');
    expect(html).toContain('id="input"');
  });

  it('renders the query via textContent (no HTML interpolation)', () => {
    expect(html).toContain("textContent = text");
    expect(html).not.toContain('innerHTML = q');
  });

  it('reads source fields from metadata individually (never serializes embeddings)', () => {
    expect(html).toContain('s.metadata && s.metadata.title');
    expect(html).not.toContain('JSON.stringify(s)');
  });

  it('offers a DuckDuckGo fallback when the backend is down', () => {
    expect(html).toContain('duckduckgo.com');
  });
});

describe('getSearchUrl / perplexica mode', () => {
  it('routes queries to pab://search when PAB_PERPLEXICA_URL is set', () => {
    process.env[ENV] = 'http://127.0.0.1:3000';
    expect(getSearchUrl('who built electron')).toBe('pab://search?q=who%20built%20electron');
  });

  it('falls back to the plain search URL when unset', () => {
    delete process.env[ENV];
    delete process.env.PAB_SEARCH_URL;
    expect(getSearchUrl('test')).toBe('https://duckduckgo.com/?q=test');
  });
});
