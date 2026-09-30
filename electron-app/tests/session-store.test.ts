import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore, buildSessionTab } from '../src/main/browser/pure/session-store';
import { MemoryStorageAdapter } from '../src/main/browser/storage/storage-adapter';
import type { SessionSnapshot, SessionTab } from '../src/shared/browser-types';

function makeTab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    id: 'tab_1',
    url: 'https://example.com/',
    pendingUrl: 'https://example.com/',
    title: 'Example',
    isIncognito: false,
    navigation: { backStack: [], current: 'https://example.com/', forwardStack: [] },
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  const tab = makeTab();
  return {
    version: 1,
    tabs: [tab],
    order: [tab.id],
    activeId: tab.id,
    ...overrides,
  };
}

describe('SessionStore / load', () => {
  it('returns null when storage is empty', async () => {
    const store = new SessionStore(new MemoryStorageAdapter());
    expect(await store.load()).toBeNull();
  });

  it('loads a valid persisted session', async () => {
    const storage = new MemoryStorageAdapter(JSON.stringify(makeSnapshot()));
    const store = new SessionStore(storage);
    const snap = await store.load();
    expect(snap).not.toBeNull();
    expect(snap!.tabs).toHaveLength(1);
    expect(snap!.tabs[0].url).toBe('https://example.com/');
    expect(snap!.activeId).toBe('tab_1');
  });

  it('returns null on corrupt JSON (does not throw)', async () => {
    const store = new SessionStore(new MemoryStorageAdapter('{not json'));
    expect(await store.load()).toBeNull();
  });

  it('returns null on wrong version', async () => {
    const store = new SessionStore(
      new MemoryStorageAdapter(JSON.stringify({ version: 2, tabs: [], order: [] }))
    );
    expect(await store.load()).toBeNull();
  });

  it('filters out incognito tabs on load (defensive)', async () => {
    const incognito = makeTab({ id: 'tab_inc', isIncognito: true });
    const snap = makeSnapshot({ tabs: [makeTab(), incognito], order: ['tab_1', 'tab_inc'] });
    const store = new SessionStore(new MemoryStorageAdapter(JSON.stringify(snap)));
    const loaded = await store.load();
    expect(loaded!.tabs).toHaveLength(1);
    expect(loaded!.tabs[0].id).toBe('tab_1');
    expect(loaded!.order).toEqual(['tab_1']);
  });

  it('is idempotent (loads once)', async () => {
    const storage = new MemoryStorageAdapter(JSON.stringify(makeSnapshot()));
    const store = new SessionStore(storage);
    await store.load();
    // Mutate storage; second load should return the cached snapshot.
    await storage.write(JSON.stringify(makeSnapshot({ tabs: [] })));
    const again = await store.load();
    expect(again!.tabs).toHaveLength(1);
  });
});

describe('SessionStore / save', () => {
  it('persists the snapshot and returns the filtered result', async () => {
    const storage = new MemoryStorageAdapter();
    const store = new SessionStore(storage);
    const saved = await store.save(makeSnapshot());
    expect(saved.tabs).toHaveLength(1);
    const raw = JSON.parse(storage.peek());
    expect(raw.version).toBe(1);
    expect(raw.tabs).toHaveLength(1);
  });

  it('filters out incognito tabs before writing', async () => {
    const storage = new MemoryStorageAdapter();
    const store = new SessionStore(storage);
    const incognito = makeTab({ id: 'tab_inc', isIncognito: true });
    const snap = makeSnapshot({ tabs: [makeTab(), incognito], order: ['tab_1', 'tab_inc'] });
    const saved = await store.save(snap);
    expect(saved.tabs).toHaveLength(1);
    expect(saved.tabs[0].id).toBe('tab_1');
    expect(saved.order).toEqual(['tab_1']);
    // The written file must NOT contain the incognito tab.
    const raw = JSON.parse(storage.peek());
    expect(raw.tabs).toHaveLength(1);
    expect(raw.tabs[0].id).toBe('tab_1');
  });

  it('clears activeId if it points to an incognito tab', async () => {
    const storage = new MemoryStorageAdapter();
    const store = new SessionStore(storage);
    const incognito = makeTab({ id: 'tab_inc', isIncognito: true });
    const snap = makeSnapshot({
      tabs: [makeTab(), incognito],
      order: ['tab_1', 'tab_inc'],
      activeId: 'tab_inc',
    });
    const saved = await store.save(snap);
    expect(saved.activeId).toBeNull();
  });

  it('emits onSaved with the filtered snapshot', async () => {
    const storage = new MemoryStorageAdapter();
    let savedSnap: SessionSnapshot | null = null;
    const store = new SessionStore(storage, { onSaved: (s) => (savedSnap = s) });
    await store.save(makeSnapshot());
    expect(savedSnap).not.toBeNull();
    expect(savedSnap!.tabs).toHaveLength(1);
  });
});

describe('buildSessionTab', () => {
  it('copies tab fields and clones navigation arrays', () => {
    const nav = { backStack: ['https://a.com'], current: 'https://b.com', forwardStack: ['https://c.com'] };
    const tab = buildSessionTab(
      { id: 't1', url: 'https://b.com', pendingUrl: 'https://b.com', title: 'B', isIncognito: false },
      nav
    );
    expect(tab.id).toBe('t1');
    expect(tab.navigation.backStack).toEqual(['https://a.com']);
    expect(tab.navigation.current).toBe('https://b.com');
    expect(tab.navigation.forwardStack).toEqual(['https://c.com']);
    // Mutating the source should not affect the built tab (cloned).
    nav.backStack.push('https://d.com');
    expect(tab.navigation.backStack).toEqual(['https://a.com']);
  });
});
