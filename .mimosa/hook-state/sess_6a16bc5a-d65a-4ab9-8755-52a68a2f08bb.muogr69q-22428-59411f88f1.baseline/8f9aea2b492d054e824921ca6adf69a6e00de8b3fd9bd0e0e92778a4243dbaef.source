/**
 * MemoryStore tests — confirmed user facts.
 */
import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../src/main/browser/agent/pure/memory-store';
import type { StorageAdapter } from '../src/main/browser/storage/storage-adapter';

function makeAdapter(): StorageAdapter & { written: string[] } {
  const state = { written: [] as string[] };
  return {
    get written() {
      return state.written;
    },
    read: async () => state.written[state.written.length - 1] ?? '',
    write: async (data: string) => {
      state.written.push(data);
    },
  } as unknown as StorageAdapter & { written: string[] };
}

describe('MemoryStore', () => {
  it('confirms and persists facts', async () => {
    const adapter = makeAdapter();
    const store = new MemoryStore(adapter, () => 'f1', () => 1000);
    await store.load();
    const fact = await store.confirm('Prefers dark UI');
    expect(fact).toMatchObject({ id: 'f1', fact: 'Prefers dark UI' });
    expect(store.factTexts()).toEqual(['Prefers dark UI']);
    expect(adapter.written[0]).toContain('Prefers dark UI');
  });

  it('normalizes whitespace and dedupes case-insensitively', async () => {
    const store = new MemoryStore(makeAdapter(), () => 'f1', () => 1000);
    await store.load();
    await store.confirm('  prefers   dark UI  ');
    const again = await store.confirm('Prefers Dark UI');
    expect(again?.id).toBe('f1');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].fact).toBe('prefers dark UI');
  });

  it('rejects empty facts and caps length', async () => {
    const store = new MemoryStore(makeAdapter(), () => 'f1', () => 1000);
    await store.load();
    expect(await store.confirm('   ')).toBeNull();
    const long = await store.confirm('x'.repeat(400));
    expect(long?.fact.length).toBe(300);
  });

  it('evicts oldest facts past the limit', async () => {
    let n = 0;
    const store = new MemoryStore(makeAdapter(), () => `f${++n}`, () => 1000 + n, 3);
    await store.load();
    await store.confirm('a');
    await store.confirm('b');
    await store.confirm('c');
    await store.confirm('d');
    expect(store.list().map((f) => f.fact)).toEqual(['b', 'c', 'd']);
  });

  it('recovers clean from a corrupt file', async () => {
    const broken = {
      read: async () => '{not json',
      write: async () => {},
    } as unknown as StorageAdapter;
    const store = new MemoryStore(broken);
    await store.load();
    expect(store.list()).toEqual([]);
    const ok = await store.confirm('works after corruption');
    expect(ok?.fact).toBe('works after corruption');
  });

  it('delete removes facts', async () => {
    const store = new MemoryStore(makeAdapter(), () => 'f1', () => 1000);
    await store.load();
    await store.confirm('temp fact');
    expect(await store.delete('f1')).toBe(true);
    expect(await store.delete('f1')).toBe(false);
    expect(store.list()).toHaveLength(0);
  });
});
