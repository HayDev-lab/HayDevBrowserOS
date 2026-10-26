/**
 * New Tab Page pure tests — top-sites computation, HTML escaping, template.
 */
import { describe, it, expect } from 'vitest';
import {
  computeTopSites,
  buildNewTabHtml,
  escapeHtml,
} from '../src/main/browser/pure/newtab-page';
import type { HistoryEntry } from '@shared/browser-types';

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'h_' + Math.random().toString(36).slice(2, 8),
    url: 'https://example.com/',
    title: 'Example',
    visitedAt: 1_000_000,
    visitCount: 1,
    ...over,
  };
}

describe('computeTopSites', () => {
  it('groups by hostname and sums visit counts', () => {
    const top = computeTopSites([
      entry({ url: 'https://mail.example.com/a', title: 'Mail A', visitCount: 3 }),
      entry({ url: 'https://mail.example.com/b', title: 'Mail B', visitCount: 7 }),
      entry({ url: 'https://other.org/', title: 'Other', visitCount: 5 }),
    ]);
    expect(top[0]).toMatchObject({ title: 'Mail B' }); // 10 visits > 5
    expect(top).toHaveLength(2);
  });

  it('keeps the most recent title per host', () => {
    const top = computeTopSites([
      entry({ url: 'https://news.test/x', title: 'Old', visitedAt: 1, visitCount: 1 }),
      entry({ url: 'https://news.test/y', title: 'New', visitedAt: 2, visitCount: 1 }),
    ]);
    expect(top[0].title).toBe('New');
  });

  it('excludes non-http(s) URLs (internal pages, about:blank)', () => {
    const top = computeTopSites([
      entry({ url: 'pab://newtab', title: 'New Tab', visitCount: 99 }),
      entry({ url: 'about:blank', title: 'blank', visitCount: 99 }),
      entry({ url: 'file:///C:/x', title: 'file', visitCount: 99 }),
      entry({ url: 'https://real.com/', title: 'Real', visitCount: 1 }),
    ]);
    expect(top).toHaveLength(1);
    expect(top[0].url).toBe('https://real.com/');
  });

  it('caps the result at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      entry({ url: `https://site${i}.com/`, title: `S${i}`, visitCount: 1 })
    );
    expect(computeTopSites(many, 8)).toHaveLength(8);
  });
});

describe('escapeHtml / buildNewTabHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<script>"a"&\'b\'</script>')).toBe(
      '&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/script&gt;'
    );
  });

  it('renders top sites as plain links with escaped attributes', () => {
    const html = buildNewTabHtml([
      { url: 'https://ok.com/', title: 'Fine' },
      { url: 'https://evil.com/?q=<script>', title: '"><img src=x onerror=1>' },
    ]);
    expect(html).toContain('href="https://ok.com/"');
    // The injected title/URL must appear escaped, never raw.
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror=1><');
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
  });

  it('omits the frequent-sites section entirely when there is no history', () => {
    const html = buildNewTabHtml([]);
    expect(html).not.toContain('class="sites"');
    expect(html).not.toContain('FREQUENT SITES');
  });

  it('hosts the HayDev Search entry box that navigates to pab://search', () => {
    const html = buildNewTabHtml([]);
    expect(html).toContain('id="sform"');
    // Form action targets the search home; JS submits route through the
    // backend searchNavigate bridge (location.href is the fallback).
    expect(html).toContain('action="pab://search/"');
    expect(html).toContain("searchNavigate('search', '?q=' + encodeURIComponent(v) + '&src=web')");
    expect(html).toContain('HayDev Search');
  });

  it('is a self-contained document with the clock container', () => {
    const html = buildNewTabHtml([{ url: 'https://x.com/', title: 'X' }]);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('id="time"');
  });

  // ---- Matrix NTP: planet + engines + attachments -------------------------

  it('embeds the rotating planet layers behind the hero', () => {
    const html = buildNewTabHtml([]);
    expect(html).toContain('id="planet-shell"');
    expect(html).toContain('id="planet-canvas"');
    // Layers: rain (z0) → shell (z1) → planet (z2) → readability (z3) → UI (z4).
    expect(html).toContain('z-index: 2; pointer-events: none');
    expect(html).toContain('class="readability"');
  });

  it('renders the hero brand and tagline from the concept', () => {
    const html = buildNewTabHtml([]);
    expect(html).toContain('HayDev Browser OS</h1>');
    expect(html).toContain('Same Internet. Deeper Intelligence.');
  });

  it('offers the three real engine cards with distinct routing', () => {
    const html = buildNewTabHtml([]);
    // Concept cards: title + subtitle, HayDev active by default.
    expect(html).toContain('data-engine="haydev"');
    expect(html).toContain('HayDev Search');
    expect(html).toContain('Deep Research agent');
    expect(html).toContain('data-engine="perplexity"');
    expect(html).toContain('Perplexity Search');
    expect(html).toContain('AI + Web answers');
    expect(html).toContain('data-engine="darkweb"');
    expect(html).toContain('Deep/Dark Web Search');
    expect(html).toContain('Beyond the surface');
    expect(html).toContain('id="engine-haydev"');
    expect(html).toContain('aria-checked="true" data-engine="haydev"');
    // Real routing targets: darkweb searches INLINE on this page (the host
    // runs the same DarkWebService job; results render into #dwresults —
    // never a navigation), web mode through the searchNavigate bridge.
    expect(html).toContain('runInlineDarkwebSearch(v)');
    expect(html).toContain('id="dwresults"');
    expect(html).toContain("searchNavigate('search', '?q=' + encodeURIComponent(v) + '&src=web')");
    // Engine choice survives within the tab (sessionStorage, per-tab state).
    expect(html).toContain("sessionStorage.getItem(ENGINE_KEY)");
  });

  it('renders the concept extras: category chips, mottos, news strip slot', () => {
    const html = buildNewTabHtml([]);
    expect(html).toContain('data-cat="AI"');
    expect(html).toContain('data-cat="Research"');
    expect(html).toContain('data-cat="Code"');
    expect(html).toContain('data-cat="Legal"');
    expect(html).toContain('data-cat="Business"');
    expect(html).toContain('data-cat="Tech"');
    expect(html).toContain('A more capable');
    expect(html).toContain('Intelligence');
    expect(html).toContain('Today in Tech');
    // Offline/empty news → quiet honest empty state, never fake headlines.
    expect(html).toContain('No connection');
  });

  it('renders real news items escaped, with rank/source/age', () => {
    const html = buildNewTabHtml([], [
      {
        rank: '01',
        title: 'Quantum <script>alert(1)</script> Milestone',
        url: 'https://example.com/a?x=1&y=2',
        discussionUrl: 'https://news.ycombinator.com/item?id=1',
        age: '2h ago',
        sourceKey: 'EX',
      },
    ]);
    expect(html).toContain('news__card');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('href="https://example.com/a?x=1&amp;y=2"');
    expect(html).toContain('2h ago');
    expect(html).toContain('>EX<');
  });

  it('has functional attachment controls wired to the scoped bridge', () => {
    const html = buildNewTabHtml([]);
    expect(html).toContain('id="sattach"');
    expect(html).toContain('id="schips"');
    expect(html).toContain('id="sstatus"');
    expect(html).toContain('__pabNewTab');
    expect(html).toContain('pickAttachment');
    expect(html).toContain('runResearch');
    // Attachments always route to the agent pipeline — the only engine
    // that can consume files/images.
    expect(html).toContain('chips.length > 0');
    expect(html).toContain('runResearch(v)');
    // Dedicated image picker next to the file picker (concept row).
    expect(html).toContain('id="simage"');
    // Without the bridge the attach buttons hide — no dead UI.
    expect(html).toContain("attachBtn.style.display = 'none'");
  });

  it('does not inline user input anywhere in the template', () => {
    // Top sites are the only dynamic input — they must stay escaped (covered
    // above) and no query-string reflection exists in the template.
    const html = buildNewTabHtml([]);
    expect(html).not.toContain('location.search');
  });
});
