/**
 * HTML extraction + sanitization (spec §13/§17) and provider parsers.
 */
import { describe, it, expect } from 'vitest';
import {
  extractTitle,
  extractText,
  extractLinks,
  sanitizeForPreview,
} from '../src/main/browser/darkweb/pure/html-extract';
import { parseAhmiaResults, parseAhmiaToken, buildAhmiaSearchUrl } from '../src/main/browser/darkweb/pure/ahmia-parser';
import { parseTor66Results } from '../src/main/browser/darkweb/pure/tor66-parser';

const A = 'a'.repeat(56);
const B = 'b'.repeat(56);

describe('extractTitle / extractText', () => {
  it('extracts and decodes the title', () => {
    expect(extractTitle('<html><title>Foo &amp; Bar</title></html>')).toBe('Foo & Bar');
    expect(extractTitle('<html><head></head></html>')).toBeNull();
  });

  it('drops script/style content from text and strips tags', () => {
    const html = `<html><head><style>p{color:red}</style></head><body><h1>Hi</h1><script>alert(1)</script><p>Body &quot;text&quot;</p></body></html>`;
    const text = extractText(html, 1000);
    expect(text).toContain('Hi');
    expect(text).toContain('Body "text"');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });

  it('caps length', () => {
    expect(extractText('<p>' + 'x'.repeat(500) + '</p>', 10).length).toBe(10);
  });
});

describe('extractLinks', () => {
  it('resolves relative links and keeps http(s) only', () => {
    const html = `<a href="/x">A</a><a href="https://${B}.onion/y">B</a><a href="javascript:alert(1)">C</a><a href="mailto:a@b">D</a>`;
    const links = extractLinks(html, `http://${A}.onion/`, 10);
    const urls = links.map((l) => l.url);
    expect(urls).toContain(`http://${A}.onion/x`);
    expect(urls).toContain(`https://${B}.onion/y`);
    expect(urls.some((u) => u.startsWith('javascript'))).toBe(false);
    expect(urls.some((u) => u.startsWith('mailto'))).toBe(false);
  });

  it('honours the cap', () => {
    const html = Array.from({ length: 20 }, (_, i) => `<a href="/${i}">L</a>`).join('');
    expect(extractLinks(html, `http://${A}.onion/`, 5)).toHaveLength(5);
  });
});

describe('sanitizeForPreview (spec §17)', () => {
  const evil = `<div onclick="pwn()">hi<script>alert(1)</script></div>
    <iframe src="http://evil"></iframe>
    <a href="javascript:bad()">x</a>
    <a href="http://${B}.onion/ok">ok</a>
    <img src=x onerror=alert(2)>`;

  it('removes scripts/iframes/handlers/javascript: URLs, keeps text + safe hrefs', () => {
    const out = sanitizeForPreview(evil);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('hi');
    expect(out).toContain(`http://${B}.onion/ok`);
    expect(out).toMatch(new RegExp(`<a href="http://${B}\\.onion/ok"`));
  });

  it('escapes raw text so nothing injects tags', () => {
    const out = sanitizeForPreview('plain <b>text</b> & <img src=x>');
    expect(out).toContain('&amp;');
    expect(out).toContain('<b>text</b>');
    expect(out).not.toMatch(/<img/); // tags not on the allowlist vanish
  });

  it('drops head entirely', () => {
    const out = sanitizeForPreview('<head><meta charset="x"><title>t</title></head><p>body</p>');
    expect(out).not.toContain('<title');
    expect(out).toContain('body');
  });
});

describe('Ahmia parser (mirrors verified pyahmia behaviour)', () => {
  const fixture = `
  <div class="resultsSubheader">About 3 results</div>
  <ul>
    <li class="result">
      <h4>Tor Market</h4>
      <p>Best &amp; biggest market</p>
      <cite>msddddddddddddddddddddddddddddddddddddddddddddd7pqdfz.onion</cite>
      <span class="lastSeen" data-timestamp="1690000000000">2 days ago</span>
    </li>
    <li class="result">
      <h4>Forum</h4>
      <p><b>Discussion</b> board</p>
      <cite>http://${B}.onion/forum</cite>
      <span class="lastSeen" data-timestamp="1690000000">2 days ago</span>
    </li>
  </ul>`;
  // The first cite must be a syntactically valid v3 label for normalize.
  const realCite = `${'a'.repeat(56)}.onion`;

  it('parses title/url/description/lastSeen from li.result blocks', () => {
    const html = fixture.replace('msddddddddddddddddddddddddddddddddddddddddddddd7pqdfz.onion', realCite);
    const results = parseAhmiaResults(html);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: 'Tor Market', url: realCite, snippet: 'Best & biggest market' });
    expect(results[0].lastSeen).toBe(1690000000000);
    expect(results[1].url).toBe(`http://${B}.onion/forum`);
    expect(results[1].lastSeen).toBe(1_690_000_000_000); // seconds → ms
  });

  it('parses a bot-check page to zero results (not an error)', () => {
    expect(parseAhmiaResults('<html><body>Too many requests</body></html>')).toEqual([]);
  });

  it('strips inner markup from titles (redirect <a> wrappers)', () => {
    const cite = `${'c'.repeat(56)}.onion`;
    const html = `<li class="result"><h4><a href="/search/redirect?search_term=test">Clean Title</a></h4><p>desc</p><cite>${cite}</cite></li>`;
    const results = parseAhmiaResults(html);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Clean Title');
    expect(results[0].title).not.toContain('<a');
  });

  it('extracts the hidden anti-bot token from the homepage', () => {
    const token = parseAhmiaToken('<form><input type="hidden" name="csrf_but_valid" value="tok123">');
    expect(token).toEqual({ name: 'csrf_but_valid', value: 'tok123', scrapedAt: expect.any(Number) });
    expect(parseAhmiaToken('<form>no token</form>')).toBeNull();
  });

  it('builds the search URL with q + d + token', () => {
    const url = buildAhmiaSearchUrl('https://ahmia.fi', 'test q', { name: 't', value: 'v', scrapedAt: 0 }, 7);
    expect(url).toBe('https://ahmia.fi/search?q=test+q&d=7&t=v');
  });
});

describe('Tor66 parser', () => {
  it('extracts onion anchors, skipping internal navigation', () => {
    const html = `
      <a href="http://${B}.onion/page1">Result One</a>
      <a href="${A}.onion">Bare host result</a>
      <a href="http://${B}.onion/search?q=x">Internal search</a>
      <a href="https://clearnet.example.com/">Clearnet junk</a>
      <a href="http://${B}.onion/page1">Duplicate</a>`;
    const results = parseTor66Results(html);
    const urls = results.map((r) => r.url);
    expect(urls).toContain(`http://${B}.onion/page1`);
    expect(urls).toContain(`http://${A}.onion`);
    expect(urls).not.toContain(`http://${B}.onion/search?q=x`);
    expect(urls.filter((u) => u === `http://${B}.onion/page1`)).toHaveLength(1);
    expect(results.find((r) => r.url === `http://${A}.onion`)?.title).toBe('Bare host result');
  });
});
