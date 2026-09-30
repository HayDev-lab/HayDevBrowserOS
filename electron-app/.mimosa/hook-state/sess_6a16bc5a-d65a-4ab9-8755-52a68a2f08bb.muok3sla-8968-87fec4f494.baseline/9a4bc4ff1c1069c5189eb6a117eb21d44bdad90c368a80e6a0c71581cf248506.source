/**
 * ResearchSourceLedger — pure pipeline tests.
 *
 * PROMPT 9 correction #1: a source is VERIFIED only after a successful
 * readPage (navigate alone does NOT add a citable source).
 */
import { describe, it, expect } from 'vitest';
import { ResearchSourceLedger } from '../src/main/browser/research/pure/source-ledger';
import { RESEARCH_BOUNDS } from '@shared/research-types';

describe('ResearchSourceLedger — pure pipeline', () => {
  it('records a visited source from a successful read', () => {
    const ledger = new ResearchSourceLedger();
    const out = ledger.record({
      url: 'https://example.com/a',
      title: 'A',
      excerpt: 'some excerpt',
      now: 100,
    });
    expect(out.kind).toBe('added');
    if (out.kind === 'added') {
      expect(out.source.id).toBe(1);
      expect(out.source.status).toBe('visited');
      expect(out.source.url).toBe('https://example.com/a');
    }
    expect(ledger.listVisited()).toHaveLength(1);
  });

  it('marks a source FAILED when failed:true is passed (failed reads are NOT citable)', () => {
    const ledger = new ResearchSourceLedger();
    ledger.record({ url: 'https://example.com/x', title: '', failed: true, now: 5 });
    expect(ledger.listVisited()).toHaveLength(0);
    expect(ledger.list()).toHaveLength(1);
    expect(ledger.list()[0]!.status).toBe('failed');
    expect(ledger.byId(1)).toBeNull();
  });

  it('a failed source can be RECOVERED by a later successful read of the same URL', () => {
    const ledger = new ResearchSourceLedger();
    ledger.record({ url: 'https://example.com/x', title: '', failed: true, now: 5 });
    const out = ledger.record({ url: 'https://example.com/x', title: 'X', excerpt: 'ok', now: 9 });
    expect(out.kind).toBe('updated');
    expect(ledger.listVisited()).toHaveLength(1);
    expect(ledger.byId(1)?.status).toBe('visited');
  });

  it('deduplicates by canonical URL (case-insensitive host + fragment dropped)', () => {
    const ledger = new ResearchSourceLedger();
    ledger.record({ url: 'https://Example.com/page', title: 'P', now: 1 });
    const out = ledger.record({ url: 'https://example.com/page#frag', title: 'P2', excerpt: 'x', now: 2 });
    expect(out.kind).toBe('updated');
    expect(ledger.size()).toBe(1);
  });

  it('treats root path "/" and empty path as the same source', () => {
    const ledger = new ResearchSourceLedger();
    ledger.record({ url: 'https://example.com/', title: 'R', now: 1 });
    const out = ledger.record({ url: 'https://example.com', title: 'R2', excerpt: 'x', now: 2 });
    expect(out.kind).toBe('updated');
    expect(ledger.size()).toBe(1);
  });

  it('byId returns null for a FAILED source (cannot confirm a claim)', () => {
    const ledger = new ResearchSourceLedger();
    ledger.record({ url: 'https://example.com/f', title: '', failed: true, now: 1 });
    expect(ledger.byId(1)).toBeNull();
  });

  it('byUrl returns null for a FAILED source', () => {
    const ledger = new ResearchSourceLedger();
    ledger.record({ url: 'https://example.com/f', title: '', failed: true, now: 1 });
    expect(ledger.byUrl('https://example.com/f')).toBeNull();
  });

  it('enforces MAX_SOURCES hard bound', () => {
    const ledger = new ResearchSourceLedger();
    for (let i = 0; i < RESEARCH_BOUNDS.MAX_SOURCES; i += 1) {
      ledger.record({ url: `https://example.com/s${i}`, title: `S${i}`, now: i });
    }
    const out = ledger.record({ url: 'https://example.com/overflow', title: 'O', now: 99 });
    expect(out.kind).toBe('limit-reached');
    expect(ledger.size()).toBe(RESEARCH_BOUNDS.MAX_SOURCES);
  });

  it('preserves arrival order regardless of update order', () => {
    const ledger = new ResearchSourceLedger();
    ledger.record({ url: 'https://a.com', title: 'A', now: 1 });
    ledger.record({ url: 'https://b.com', title: 'B', now: 2 });
    ledger.record({ url: 'https://a.com', title: 'A2', excerpt: 'updated', now: 3 });
    const list = ledger.list();
    expect(list[0]!.url).toBe('https://a.com');
    expect(list[0]!.title).toBe('A2');
    expect(list[1]!.url).toBe('https://b.com');
    expect(list[0]!.order).toBe(1);
    expect(list[1]!.order).toBe(2);
  });

  it('clamps the excerpt to RESEARCH_BOUNDS.MAX_EXCERPT_LENGTH', () => {
    const ledger = new ResearchSourceLedger();
    const long = 'x'.repeat(RESEARCH_BOUNDS.MAX_EXCERPT_LENGTH + 500);
    ledger.record({ url: 'https://e.com', title: 'E', excerpt: long, now: 1 });
    expect(ledger.list()[0]!.excerpt.length).toBe(RESEARCH_BOUNDS.MAX_EXCERPT_LENGTH);
  });

  it('normalizes whitespace inside excerpts', () => {
    const ledger = new ResearchSourceLedger();
    ledger.record({
      url: 'https://e.com',
      title: 'E',
      excerpt: '  foo\n\n   bar  \t baz  ',
      now: 1,
    });
    expect(ledger.list()[0]!.excerpt).toBe('foo bar baz');
  });

  it('a duplicate visit without changes returns duplicate-visited', () => {
    const ledger = new ResearchSourceLedger();
    ledger.record({ url: 'https://d.com', title: 'D', excerpt: 'same', now: 1 });
    const out = ledger.record({ url: 'https://d.com', title: 'D', excerpt: 'same', now: 2 });
    expect(out.kind).toBe('duplicate-visited');
  });

  it('drops the fragment when canonicalizing', () => {
    const ledger = new ResearchSourceLedger();
    ledger.record({ url: 'https://example.com/p#frag', title: 'P', now: 1 });
    const out = ledger.record({ url: 'https://example.com/p#other', title: 'P2', excerpt: 'x', now: 2 });
    expect(out.kind).toBe('updated');
    expect(ledger.size()).toBe(1);
  });

  it('clear() is NOT part of the V1 API (memory-only, no persistence methods)', () => {
    const ledger = new ResearchSourceLedger();
    expect((ledger as unknown as { clear?: unknown }).clear).toBeUndefined();
    expect((ledger as unknown as { persist?: unknown }).persist).toBeUndefined();
    expect((ledger as unknown as { load?: unknown }).load).toBeUndefined();
  });
});