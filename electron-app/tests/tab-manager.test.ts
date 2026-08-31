import { describe, it, expect, beforeEach } from 'vitest';
import { TabManager } from '../src/main/browser/pure/tab-manager';
import type { TabManagerEvents } from '../src/main/browser/pure/tab-manager';
import { makeIdGen, makeClock } from './_helpers';

// Helper: build an event sink + counter bundle so tests can assert which
// events fired and how many times.
function makeEvents2() {
  const out: any = {
    opens: 0, closes: 0, activates: 0, updates: 0, reorders: 0,
    history: [] as string[],
  };
  const events: TabManagerEvents = {
    onTabOpened: () => { out.opens++; },
    onTabClosed: (id: string) => { out.closes++; out.history.push(`closed:${id}`); },
    onTabActivated: (id: string, prev: string | null) => { out.activates++; out.history.push(`activated:${id}:${prev ?? 'null'}`); },
    onTabUpdated: () => { out.updates++; },
    onTabReordered: () => { out.reorders++; },
  };
  out.events = events;
  return out;
}

describe('TabManager / open and activate', () => {
  it('opens a single tab and activates it by default', () => {
    const ev = makeEvents2();
    const tm = new TabManager(ev.events, makeIdGen('t'), makeClock());
    const id = tm.openTab({ url: 'https://a.com' });

    expect(id).toBe('t_1');
    expect(tm.size()).toBe(1);
    expect(tm.getActiveId()).toBe(id);

    const tab = tm.getTab(id);
    expect(tab).not.toBeNull();
    expect(tab!.pendingUrl).toBe('https://a.com');
    expect(tab!.isActive).toBe(true);
    expect(tab!.isIncognito).toBe(false);

    expect(ev.opens).toBe(0); // activated path skips onTabOpened
    expect(ev.activates).toBe(1);
  });

  it('opens a background tab without activating it', () => {
    const ev = makeEvents2();
    const tm = new TabManager(ev.events, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    const id2 = tm.openTab({ url: 'https://b.com', background: true });

    expect(tm.getActiveId()).toBe('t_1');
    expect(tm.getTab(id2)!.isActive).toBe(false);
    expect(ev.opens).toBe(1); // onTabOpened fired for the background tab
  });

  it('activates the explicit activate:false tab as background', () => {
    const ev = makeEvents2();
    const tm = new TabManager(ev.events, makeIdGen('t'), makeClock());
    const id1 = tm.openTab({ url: 'https://a.com' });
    const id2 = tm.openTab({ url: 'https://b.com', activate: false });
    expect(tm.getActiveId()).toBe(id1);
    expect(tm.getTab(id2)!.isActive).toBe(false);
  });
});

describe('TabManager / order and list', () => {
  it('preserves insertion order', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.openTab({ url: 'https://b.com' });
    tm.openTab({ url: 'https://c.com' });

    const order = tm.getOrder();
    expect(order).toEqual(['t_1', 't_2', 't_3']);
    const tabs = tm.listTabs();
    expect(tabs.map((t) => t.id)).toEqual(['t_1', 't_2', 't_3']);
  });
});

describe('TabManager / close', () => {
  it('closes the active tab and activates the right neighbour', () => {
    const ev = makeEvents2();
    const tm = new TabManager(ev.events, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.openTab({ url: 'https://b.com' });
    tm.openTab({ url: 'https://c.com' });
    // Active is t_3; close it.
    const ok = tm.closeTab('t_3');
    expect(ok).toBe(true);
    expect(tm.size()).toBe(2);
    expect(tm.getActiveId()).toBe('t_2');
  });

  it('closes the active tab and falls back to the left neighbour', () => {
    const ev = makeEvents2();
    const tm = new TabManager(ev.events, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.openTab({ url: 'https://b.com' });
    tm.openTab({ url: 'https://c.com' });
    tm.activateTab('t_1');
    expect(tm.getActiveId()).toBe('t_1');
    tm.closeTab('t_1', { activateAfterClose: 'left' });
    expect(tm.getActiveId()).toBe('t_2');
  });

  it('returns false for unknown tab id', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    expect(tm.closeTab('does-not-exist')).toBe(false);
  });

  it('does not change active id when closing a background tab', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.openTab({ url: 'https://b.com', background: true });
    tm.closeTab('t_2');
    expect(tm.getActiveId()).toBe('t_1');
  });

  it('sets activeId to null when closing the last tab', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.closeTab('t_1');
    expect(tm.size()).toBe(0);
    expect(tm.getActiveId()).toBeNull();
  });
});

describe('TabManager / activate', () => {
  it('returns true for an existing tab', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    const id1 = tm.openTab({ url: 'https://a.com' });
    const id2 = tm.openTab({ url: 'https://b.com' });
    expect(tm.getActiveId()).toBe(id2);
    expect(tm.activateTab(id1)).toBe(true);
    expect(tm.getActiveId()).toBe(id1);
    expect(tm.getTab(id2)!.isActive).toBe(false);
  });

  it('returns false for an unknown tab id', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    expect(tm.activateTab('does-not-exist')).toBe(false);
  });

  it('is a no-op when activating the already-active tab', () => {
    const ev = makeEvents2();
    const tm = new TabManager(ev.events, makeIdGen('t'), makeClock());
    const id = tm.openTab({ url: 'https://a.com' });
    ev.activates = 0;
    expect(tm.activateTab(id)).toBe(true);
    expect(ev.activates).toBe(0);
  });
});

describe('TabManager / update', () => {
  it('applies patches and emits onTabUpdated', () => {
    const ev = makeEvents2();
    const tm = new TabManager(ev.events, makeIdGen('t'), makeClock());
    const id = tm.openTab({ url: 'https://a.com' });
    ev.updates = 0;
    tm.updateTab(id, { title: 'A', url: 'https://a.com/page', loadState: 'committed' });
    const tab = tm.getTab(id)!;
    expect(tab.title).toBe('A');
    expect(tab.url).toBe('https://a.com/page');
    expect(tab.loadState).toBe('committed');
    expect(ev.updates).toBeGreaterThanOrEqual(1);
  });

  it('ignores the `id` and `isActive` fields in patches', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    const id = tm.openTab({ url: 'https://a.com' });
    tm.updateTab(id, { id: 'hijacked', isActive: false } as any);
    const tab = tm.getTab(id)!;
    expect(tab.id).toBe(id);
    expect(tab.isActive).toBe(true);
  });

  it('returns false for unknown tab id', () => {
    const tm = new TabManager({});
    expect(tm.updateTab('does-not-exist', { title: 'x' })).toBe(false);
  });
});

describe('TabManager / reorder', () => {
  it('reorders to any permutation of the existing ids', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.openTab({ url: 'https://b.com' });
    tm.openTab({ url: 'https://c.com' });
    expect(tm.reorder(['t_3', 't_1', 't_2'])).toBe(true);
    expect(tm.getOrder()).toEqual(['t_3', 't_1', 't_2']);
  });

  it('rejects reorder with missing id', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.openTab({ url: 'https://b.com' });
    expect(tm.reorder(['t_1'])).toBe(false);
  });

  it('rejects reorder with duplicate id', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.openTab({ url: 'https://b.com' });
    expect(tm.reorder(['t_1', 't_1'])).toBe(false);
  });

  it('moveTab moves a tab to a new index', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.openTab({ url: 'https://b.com' });
    tm.openTab({ url: 'https://c.com' });
    expect(tm.moveTab('t_1', 2)).toBe(true);
    expect(tm.getOrder()).toEqual(['t_2', 't_3', 't_1']);
  });

  it('moveTab rejects out-of-range index', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.openTab({ url: 'https://b.com' });
    expect(tm.moveTab('t_1', 99)).toBe(false);
    expect(tm.moveTab('t_1', -1)).toBe(false);
  });
});

describe('TabManager / snapshot and restore', () => {
  it('snapshots and restores state', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com' });
    tm.openTab({ url: 'https://b.com' });
    tm.openTab({ url: 'https://c.com', background: true });
    tm.activateTab('t_2');
    const snap = tm.snapshot();

    const tm2 = new TabManager({}, makeIdGen('t'), makeClock());
    tm2.restore(snap);
    expect(tm2.size()).toBe(3);
    expect(tm2.getOrder()).toEqual(['t_1', 't_2', 't_3']);
    expect(tm2.getActiveId()).toBe('t_2');
    // loadState should be reset to 'idle' on restore (runtime re-navigates).
    expect(tm2.getTab('t_1')!.loadState).toBe('idle');
  });

  it('restore replaces existing state', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://existing.com' });
    const snap: any = {
      tabs: [{ id: 'restored', url: 'https://x.com', title: 'X', isActive: true }],
      order: ['restored'],
      activeId: 'restored',
    };
    tm.restore(snap);
    expect(tm.size()).toBe(1);
    expect(tm.getActiveId()).toBe('restored');
  });
});

describe('TabManager / incognito flag', () => {
  it('marks a tab as incognito when requested', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    const id = tm.openTab({ url: 'https://a.com', incognito: true });
    expect(tm.getTab(id)!.isIncognito).toBe(true);
  });
});

describe('TabManager / id collision', () => {
  it('throws when an explicit id collides', () => {
    const tm = new TabManager({}, makeIdGen('t'), makeClock());
    tm.openTab({ url: 'https://a.com', id: 'fixed' });
    expect(() => tm.openTab({ url: 'https://b.com', id: 'fixed' })).toThrow();
  });
});
