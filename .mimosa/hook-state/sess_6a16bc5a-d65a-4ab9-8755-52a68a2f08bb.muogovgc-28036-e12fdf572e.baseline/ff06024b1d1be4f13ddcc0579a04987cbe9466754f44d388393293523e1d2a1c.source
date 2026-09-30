import { describe, it, expect, beforeEach } from 'vitest';
import { BookmarksStore } from '../src/main/browser/pure/bookmarks-store';
import { MemoryStorageAdapter } from '../src/main/browser/storage/storage-adapter';
import { makeIdGen, makeClock } from './_helpers';

function setup() {
  const storage = new MemoryStorageAdapter();
  const clock = makeClock(1_000_000);
  const store = new BookmarksStore(storage, {}, makeIdGen('b'), clock);
  return { storage, clock, store };
}

describe('BookmarksStore / add', () => {
  it('adds a new bookmark', async () => {
    const { store } = setup();
    const b = await store.add({ url: 'https://a.com', title: 'A' });
    expect(b.id).toBe('b_1');
    expect(b.url).toBe('https://a.com/');
    expect(b.title).toBe('A');
    expect(b.folderId).toBeNull();
  });

  it('re-adding the same URL updates the title and does not duplicate', async () => {
    const { store } = setup();
    const b1 = await store.add({ url: 'https://a.com', title: 'A' });
    const b2 = await store.add({ url: 'https://a.com', title: 'Updated Title' });
    expect(b2.id).toBe(b1.id);
    expect(b2.title).toBe('Updated Title');
    const list = await store.list();
    expect(list.length).toBe(1);
  });

  it('canonicalizes URL (strips fragment) before dedup', async () => {
    const { store } = setup();
    await store.add({ url: 'https://a.com/page#section', title: 'A' });
    expect(await store.has('https://a.com/page')).toBe(true);
  });
});

describe('BookmarksStore / list and search', () => {
  it('returns bookmarks sorted newest first', async () => {
    const { store, clock } = setup();
    await store.add({ url: 'https://a.com', title: 'A' });
    await store.add({ url: 'https://b.com', title: 'B' });
    await store.add({ url: 'https://c.com', title: 'C' });
    const list = await store.list();
    expect(list.map((b) => b.url)).toEqual([
      'https://c.com/',
      'https://b.com/',
      'https://a.com/',
    ]);
  });

  it('search matches by url or title (case-insensitive)', async () => {
    const { store } = setup();
    await store.add({ url: 'https://rust-lang.org', title: 'Rust language' });
    await store.add({ url: 'https://python.org', title: 'Python language' });
    await store.add({ url: 'https://crates.io', title: 'Crates' });
    const results = await store.search('rust');
    expect(results.length).toBe(1);
    expect(results[0].url).toBe('https://rust-lang.org/');
  });

  it('search returns empty for empty query', async () => {
    const { store } = setup();
    await store.add({ url: 'https://a.com', title: 'A' });
    const results = await store.search('   ');
    expect(results).toEqual([]);
  });
});

describe('BookmarksStore / update', () => {
  it('updates title', async () => {
    const { store } = setup();
    const b = await store.add({ url: 'https://a.com', title: 'A' });
    expect(await store.update(b.id, { title: 'Updated' })).toBe(true);
    const got = await store.getByUrl('https://a.com');
    expect(got!.title).toBe('Updated');
  });

  it('updates url (re-indexes)', async () => {
    const { store } = setup();
    const b = await store.add({ url: 'https://a.com', title: 'A' });
    expect(await store.update(b.id, { url: 'https://b.com' })).toBe(true);
    expect(await store.has('https://a.com')).toBe(false);
    expect(await store.has('https://b.com')).toBe(true);
  });

  it('refuses to update url to a URL already bookmarked by another entry', async () => {
    const { store } = setup();
    const b1 = await store.add({ url: 'https://a.com', title: 'A' });
    await store.add({ url: 'https://b.com', title: 'B' });
    expect(await store.update(b1.id, { url: 'https://b.com' })).toBe(false);
  });

  it('returns false for unknown id', async () => {
    const { store } = setup();
    expect(await store.update('does-not-exist', { title: 'x' })).toBe(false);
  });
});

describe('BookmarksStore / delete', () => {
  it('deletes an existing bookmark', async () => {
    const { store } = setup();
    const b = await store.add({ url: 'https://a.com', title: 'A' });
    expect(await store.delete(b.id)).toBe(true);
    expect(await store.has('https://a.com')).toBe(false);
    const list = await store.list();
    expect(list.length).toBe(0);
  });

  it('returns false for unknown id', async () => {
    const { store } = setup();
    expect(await store.delete('does-not-exist')).toBe(false);
  });
});

describe('BookmarksStore / persistence', () => {
  it('persists across instances', async () => {
    const storage = new MemoryStorageAdapter();
    const store1 = new BookmarksStore(storage, {}, makeIdGen('b'), makeClock(1000));
    await store1.add({ url: 'https://a.com', title: 'A' });

    const store2 = new BookmarksStore(storage, {}, makeIdGen('b'), makeClock(1000));
    const list = await store2.list();
    expect(list.length).toBe(1);
    expect(list[0].url).toBe('https://a.com/');
  });

  it('survives corrupt persisted JSON without throwing', async () => {
    const storage = new MemoryStorageAdapter('garbage{');
    const store = new BookmarksStore(storage, {}, makeIdGen('b'), makeClock(1000));
    expect(await store.list()).toEqual([]);
  });
});

describe('BookmarksStore / folders', () => {
  it('accepts an optional folderId', async () => {
    const { store } = setup();
    const b = await store.add({
      url: 'https://a.com',
      title: 'A',
      folderId: 'folder1',
    });
    expect(b.folderId).toBe('folder1');
  });
});
