/**
 * Pure navigation stack state machine.
 *
 * Models the per-tab back/forward history. No Electron import — fully unit-
 * testable. The runtime `NavigationController` wraps a real `WebContents`
 * and delegates state tracking to this class.
 *
 * Invariants:
 *   - `current` is the last committed URL. `null` only for a brand-new tab
 *     that hasn't navigated yet.
 *   - `backStack` is the list of URLs BEFORE current, oldest first, latest
 *     at the top (end of array).
 *   - `forwardStack` is the list of URLs AFTER current, oldest first.
 *   - A fresh `navigate(url)` clears `forwardStack` (standard browser
 *     semantics: once you navigate, the forward history is discarded).
 *   - `back()`/`forward()` move URLs between stacks but never discard them.
 *   - `reload()` returns the current URL but does NOT mutate stacks.
 */
export interface NavigationStackSnapshot {
  backStack: string[];
  current: string | null;
  forwardStack: string[];
  canGoBack: boolean;
  canGoForward: boolean;
}

export class NavigationStack {
  private backStack: string[] = [];
  private current: string | null = null;
  private forwardStack: string[] = [];

  /** Reset to a fresh tab state (no navigation yet). */
  reset(): void {
    this.backStack = [];
    this.current = null;
    this.forwardStack = [];
  }

  /**
   * Commit a navigation to `url`. Pushes the previous current URL onto
   * the back stack and clears the forward stack.
   *
   * If `replace` is true, the new URL REPLACES the current entry instead of
   * pushing it (used for in-page redirects and client-side history.replaceState).
   */
  navigate(url: string, opts?: { replace?: boolean }): void {
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new Error('NavigationStack.navigate: url must be a non-empty string');
    }
    if (opts?.replace && this.current !== null) {
      // Replace current entry; back/forward stacks untouched.
      this.current = url;
      return;
    }
    if (this.current !== null) {
      this.backStack.push(this.current);
    }
    this.current = url;
    this.forwardStack = [];
  }

  canGoBack(): boolean {
    return this.backStack.length > 0;
  }

  canGoForward(): boolean {
    return this.forwardStack.length > 0;
  }

  /**
   * Move back one step. Returns the URL that becomes current, or `null` if
   * the back stack is empty.
   */
  back(): string | null {
    if (this.backStack.length === 0) return null;
    const url = this.backStack.pop()!;
    if (this.current !== null) {
      this.forwardStack.push(this.current);
    }
    this.current = url;
    return url;
  }

  /**
   * Move forward one step. Returns the URL that becomes current, or `null`
   * if the forward stack is empty.
   */
  forward(): string | null {
    if (this.forwardStack.length === 0) return null;
    const url = this.forwardStack.pop()!;
    if (this.current !== null) {
      this.backStack.push(this.current);
    }
    this.current = url;
    return url;
  }

  /** Returns the current URL for reload, without mutating state. */
  currentUrl(): string | null {
    return this.current;
  }

  /**
   * Move to a specific URL already present in either stack.
   * Used for "jump N steps back/forward" UI. Returns true if the URL was
   * found and we jumped to it, false otherwise.
   */
  jumpTo(url: string): boolean {
    if (this.current === url) return true;

    const backIdx = this.backStack.indexOf(url);
    if (backIdx !== -1) {
      // Move current + everything above backIdx onto the forward stack.
      const tail = this.backStack.splice(backIdx);
      if (this.current !== null) {
        this.forwardStack.push(this.current);
      }
      this.current = tail.shift()!;
      // `tail` now holds what was between backIdx and end — push reversed.
      for (let i = tail.length - 1; i >= 0; i--) {
        this.forwardStack.push(tail[i]);
      }
      return true;
    }

    const fwdIdx = this.forwardStack.indexOf(url);
    if (fwdIdx !== -1) {
      const tail = this.forwardStack.splice(fwdIdx);
      if (this.current !== null) {
        this.backStack.push(this.current);
      }
      this.current = tail.shift()!;
      for (let i = tail.length - 1; i >= 0; i--) {
        this.backStack.push(tail[i]);
      }
      return true;
    }

    return false;
  }

  snapshot(): NavigationStackSnapshot {
    return {
      backStack: [...this.backStack],
      current: this.current,
      forwardStack: [...this.forwardStack],
      canGoBack: this.backStack.length > 0,
      canGoForward: this.forwardStack.length > 0,
    };
  }

  /** Restore from a snapshot (e.g. session restore on restart). */
  restore(snapshot: { backStack: string[]; current: string | null; forwardStack: string[] }): void {
    this.backStack = [...snapshot.backStack];
    this.current = snapshot.current;
    this.forwardStack = [...snapshot.forwardStack];
  }
}
