import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryStore } from '../src/main/browser/pure/history-store';
import { MemoryStorageAdapter } from '../src/main/browser/storage/storage-adapter';
import { makeIdGen, makeClock } from './_helpers';

function setup() {
  const storage = new MemoryStorageAdapter();
  const clock = makeClock(1_000_000);
  const store = new HistoryStore(storage, {}, makeIdGen('h'), clock);
  return { storage, clock, store };
}

describe('HistoryStore / add and getByUrl', () => {
  it('adds a new entry on first visit', async () => {
    const { store } = setup();
    const entry = await store.add({ url: 'https://a.com', title: 'A' });
    expect(entry.id).toBe('h_1');
    expect(entry.visitCount).toBe(1);
    expect(entry.url).toBe('https://a.com/');
  });

  it('canonicalizes the URL (strips fragment)', async () => {
    const { store } = setup();
    await store.add({ url: 'https://a.com/page#section', title: 'A' });
    const got = await store.getByUrl('https://a.com/page');
    expect(got).not.toBeNull();
    expect(got!.url).toBe('https://a.com/page');
  });

  it('increments visitCount on re-visit', async () => {
    const { store } = setup();
    await store.add({ url: 'https://a.com', title: 'A' });
    await store.add({ url: 'https://a.com', title: 'A' });
    await store.add({ url: 'https://a.com', title: 'A' });
    const got = await store.getByUrl('https://a.com');
    expect(got!.visitCount).toBe(3);
  });

  it('updates the title if a new visit brings a better title', async () => {
    const { store } = setup();
    await store.add({ url: 'https://a.com', title: 'a.com' });
    await store.add({ url: 'https://a.com', title: 'Real Title' });
    const got = await store.getByUrl('https://a.com');
    expect(got!.title).toBe('Real Title');
  });

  it('preserves empty title fallback', async () => {
    const { store } = setup();
    const entry = await store.add({ url: 'https://a.com', title: '' });
    expect(entry.title).toBe('https://a.com/');
  });
});

describe('HistoryStore / query', () => {
  it('returns entries sorted by visitedAt descending', async () => {
    const { store, clock } = setup();
    const t1 = clock();
    await store.add({ url: 'https://a.com', title: 'A', visitedAt: t1 });
    const t2 = clock();
    await store.add({ url: 'https://b.com', title: 'B', visitedAt: t2 });
    const t3 = clock();
    await store.add({ url: 'https://c.com', title: 'C', visitedAt: t3 });

    const results = await store.query({});
    expect(results.map((e) => e.url)).toEqual([
      'https://c.com/',
      'https://b.com/',
      'https://a.com/',
    ]);
  });

  it('respects limit', async () => {
    const { store } = setup();
    for (let i = 0; i < 10; i++) {
      await store.add({ url: `https://a${i}.com`, title: `A${i}` });
    }
    const results = await store.query({ limit: 3 });
    expect(results.length).toBe(3);
  });

  it('filters by since', async () => {
    const { store } = setup();
    await store.add({ url: 'https://a.com', title: 'A', visitedAt: 1000 });
    await store.add({ url: 'https://b.com', title: 'B', visitedAt: 5000 });
    const results = await store.query({ since: 2000 });
    expect(results.length).toBe(1);
    expect(results[0].url).toBe('https://b.com/');
  });

  it('filters by search term in url or title', async () => {
    const { store } = setup();
    await store.add({ url: 'https://example.com/rust', title: 'Rust homepage' });
    await store.add({ url: 'https://example.com/python', title: 'Python homepage' });
    await store.add({ url: 'https://news.example.com', title: 'Daily news' });

    const results = await store.query({ search: 'rust' });
    expect(results.length).toBe(1);
    expect(results[0].title).toContain('Rust');
  });

  it('search is case-insensitive', async () => {
    const { store } = setup();
    await store.add({ url: 'https://example.com', title: 'Rust Home' });
    const results = await store.query({ search: 'RUST' });
    expect(results.length).toBe(1);
  });
});

describe('HistoryStore / delete and clear', () => {
  it('deletes an entry by id', async () => {
    const { store } = setup();
    const e = await store.add({ url: 'https://a.com', title: 'A' });
    expect(await store.delete(e.id)).toBe(true);
    expect(await store.getByUrl('https://a.com')).toBeNull();
  });

  it('returns false when deleting unknown id', async () => {
    const { store } = setup();
    expect(await store.delete('does-not-exist')).toBe(false);
  });

  it('clears all entries', async () => {
    const { store } = setup();
    await store.add({ url: 'https://a.com', title: 'A' });
    await store.add({ url: 'https://b.com', title: 'B' });
    await store.clear();
    expect(await store.query({})).toEqual([]);
  });
});

describe('HistoryStore / persistence', () => {
  it('persists across instances via the storage adapter', async () => {
    const storage = new MemoryStorageAdapter();
    const store1 = new HistoryStore(storage, {}, makeIdGen('h'), makeClock(1000));
    await store1.add({ url: 'https://a.com', title: 'A' });

    // New store instance backed by the same storage.
    const store2 = new HistoryStore(storage, {}, makeIdGen('h'), makeClock(1000));
    const results = await store2.query({});
    expect(results.length).toBe(1);
    expect(results[0].url).toBe('https://a.com/');
  });

  it('survives corrupt persisted JSON without throwing', async () => {
    const storage = new MemoryStorageAdapter('not-valid-json{');
    const store = new HistoryStore(storage, {}, makeIdGen('h'), makeClock(1000));
    await expect(store.query({})).resolves.toEqual([]);
  });
});

describe('HistoryStore / limit enforcement', () => {
  it('drops oldest entries beyond the configured limit', async () => {
    const storage = new MemoryStorageAdapter();
    const store = new HistoryStore(
      storage,
      {},
      makeIdGen('h'),
      makeClock(1000),
      3
    );
    await store.add({ url: 'https://a.com', title: 'A', visitedAt: 1000 });
    await store.add({ url: 'https://b.com', title: 'B', visitedAt: 2000 });
    await store.add({ url: 'https://c.com', title: 'C', visitedAt: 3000 });
    await store.add({ url: 'https://d.com', title: 'D', visitedAt: 4000 });

    const results = await store.query({});
    expect(results.length).toBe(3);
    // The oldest entry (https://a.com) should have been dropped.
    expect(results.find((e) => e.url === 'https://a.com/')).toBeUndefined();
  });
});

describe('HistoryStore / has', () => {
  it('returns true for visited URLs', async () => {
    const { store } = setup();
    await store.add({ url: 'https://a.com', title: 'A' });
    expect(await store.has('https://a.com')).toBe(true);
    expect(await store.has('https://a.com#section')).toBe(true); // canonicalized
  });

  it('returns false for unvisited URLs', async () => {
    const { store } = setup();
    expect(await store.has('https://never-visited.com')).toBe(false);
  });
});
