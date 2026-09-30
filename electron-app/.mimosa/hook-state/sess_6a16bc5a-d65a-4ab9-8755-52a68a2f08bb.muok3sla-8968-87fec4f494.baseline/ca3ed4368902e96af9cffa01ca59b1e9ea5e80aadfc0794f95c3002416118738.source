import { describe, it, expect } from 'vitest';
import { NavigationStack } from '../src/main/browser/pure/navigation-stack';

describe('NavigationStack / initial state', () => {
  it('starts empty', () => {
    const s = new NavigationStack();
    expect(s.canGoBack()).toBe(false);
    expect(s.canGoForward()).toBe(false);
    expect(s.currentUrl()).toBeNull();
    const snap = s.snapshot();
    expect(snap.backStack).toEqual([]);
    expect(snap.forwardStack).toEqual([]);
    expect(snap.current).toBeNull();
  });
});

describe('NavigationStack / navigate', () => {
  it('sets current and clears forward stack', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    s.navigate('https://b.com');
    expect(s.currentUrl()).toBe('https://b.com');
    expect(s.canGoBack()).toBe(true);
    expect(s.canGoForward()).toBe(false);
    expect(s.snapshot().backStack).toEqual(['https://a.com']);
  });
});

describe('NavigationStack / back and forward', () => {
  it('moves current between stacks without losing history', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    s.navigate('https://b.com');
    s.navigate('https://c.com');

    expect(s.back()).toBe('https://b.com');
    expect(s.currentUrl()).toBe('https://b.com');
    expect(s.canGoBack()).toBe(true);
    expect(s.canGoForward()).toBe(true);

    expect(s.back()).toBe('https://a.com');
    expect(s.canGoBack()).toBe(false);

    expect(s.forward()).toBe('https://b.com');
    expect(s.forward()).toBe('https://c.com');
    expect(s.canGoForward()).toBe(false);
  });

  it('back() returns null when back stack is empty', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    expect(s.back()).toBeNull();
  });

  it('forward() returns null when forward stack is empty', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    expect(s.forward()).toBeNull();
  });
});

describe('NavigationStack / navigate clears forward', () => {
  it('navigating after going back discards forward stack', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    s.navigate('https://b.com');
    s.navigate('https://c.com');
    s.back(); // current=b, forward=[c]
    s.back(); // current=a, forward=[b,c]

    expect(s.canGoForward()).toBe(true);
    s.navigate('https://d.com'); // should clear forward
    expect(s.canGoForward()).toBe(false);
    expect(s.snapshot().forwardStack).toEqual([]);
    expect(s.currentUrl()).toBe('https://d.com');
  });
});

describe('NavigationStack / replace', () => {
  it('replaces the current entry without changing back stack', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    s.navigate('https://b.com');
    s.navigate('https://c.com', { replace: true });

    // current should be c, backStack should be [a] (b was REPLACED by c,
    // not pushed — same semantics as history.replaceState), forwardStack empty.
    expect(s.currentUrl()).toBe('https://c.com');
    expect(s.snapshot().backStack).toEqual(['https://a.com']);
    expect(s.snapshot().forwardStack).toEqual([]);
  });

  it('replace on empty stack just sets current', () => {
    const s = new NavigationStack();
    s.navigate('https://only.com', { replace: true });
    expect(s.currentUrl()).toBe('https://only.com');
    expect(s.canGoBack()).toBe(false);
  });
});

describe('NavigationStack / jumpTo', () => {
  it('jumps to a URL in the back stack', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    s.navigate('https://b.com');
    s.navigate('https://c.com');
    s.navigate('https://d.com');

    expect(s.jumpTo('https://b.com')).toBe(true);
    expect(s.currentUrl()).toBe('https://b.com');
    expect(s.canGoBack()).toBe(true);
    expect(s.canGoForward()).toBe(true);
    expect(s.snapshot().backStack).toEqual(['https://a.com']);
    // forwardStack stores entries such that pop() (used by forward())
    // returns the closest-after-current first. After jumping back from d to b,
    // forward() should first go to c, then d. Therefore the array order is
    // [d, c] (d pushed first, c pushed last → pop returns c first).
    expect(s.snapshot().forwardStack).toEqual([
      'https://d.com',
      'https://c.com',
    ]);
  });

  it('jumps to a URL in the forward stack', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    s.navigate('https://b.com');
    s.navigate('https://c.com');
    s.back(); // current=b
    s.back(); // current=a

    expect(s.jumpTo('https://c.com')).toBe(true);
    expect(s.currentUrl()).toBe('https://c.com');
    expect(s.canGoBack()).toBe(true);
    expect(s.canGoForward()).toBe(false);
    expect(s.snapshot().backStack).toEqual(['https://a.com', 'https://b.com']);
  });

  it('returns false for unknown URL', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    expect(s.jumpTo('https://nonexistent.com')).toBe(false);
  });

  it('returns true when jumping to current URL (no-op)', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    expect(s.jumpTo('https://a.com')).toBe(true);
    expect(s.currentUrl()).toBe('https://a.com');
  });
});

describe('NavigationStack / reset', () => {
  it('clears all stacks', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    s.navigate('https://b.com');
    s.reset();
    expect(s.currentUrl()).toBeNull();
    expect(s.canGoBack()).toBe(false);
    expect(s.canGoForward()).toBe(false);
  });
});

describe('NavigationStack / restore', () => {
  it('restores from a snapshot', () => {
    const s = new NavigationStack();
    s.navigate('https://a.com');
    s.navigate('https://b.com');
    const snap = s.snapshot();

    const s2 = new NavigationStack();
    s2.restore(snap);
    expect(s2.currentUrl()).toBe('https://b.com');
    expect(s2.canGoBack()).toBe(true);
    expect(s2.snapshot().backStack).toEqual(['https://a.com']);
  });
});

describe('NavigationStack / error path', () => {
  it('throws on empty URL', () => {
    const s = new NavigationStack();
    expect(() => s.navigate('')).toThrow();
    expect(() => s.navigate('  ')).toThrow();
  });
});
