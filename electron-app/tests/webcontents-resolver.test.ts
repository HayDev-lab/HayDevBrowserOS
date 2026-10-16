/**
 * WebContents resolver — security tests (PROMPT 5R).
 *
 * r10 cleanup: the Electron runtime pipeline (BrowserActionService,
 * WebContentsActionAdapter, AgentController, main/index wiring, preload) was
 * removed with the Electron dependency, together with its wiring audits. The
 * remaining coverage:
 *
 *   1. The pure resolver contract (fake resolver mirroring the original
 *      BrowserCore.resolveWebContents logic): existing tab → WebContents,
 *      unknown/destroyed → null, read-only access.
 *
 *   2. The security boundary: WebContents is NEVER present in:
 *      - ExposedApi (IPC contract)
 *      - shared serializable types
 *      - renderer source
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Fake WebContents — simulates the minimal surface used by BrowserCore
// ---------------------------------------------------------------------------

interface FakeWebContents {
  isDestroyed(): boolean;
}

class FakeWebContentsImpl implements FakeWebContents {
  public destroyed = false;
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

// ---------------------------------------------------------------------------
// Fake BrowserCore resolver — mirrors BrowserCore.resolveWebContents logic
// ---------------------------------------------------------------------------

class FakeBrowserCoreResolver {
  private readonly tabWebContents = new Map<string, FakeWebContents>();

  addTab(tabId: string, wc: FakeWebContents): void {
    this.tabWebContents.set(tabId, wc);
  }

  removeTab(tabId: string): void {
    this.tabWebContents.delete(tabId);
  }

  /**
   * Mirror BrowserCore.resolveWebContents logic EXACTLY.
   * Returns the WebContents if the tab exists and is not destroyed.
   */
  resolveWebContents(tabId: string): FakeWebContents | null {
    const wc = this.tabWebContents.get(tabId);
    if (!wc) return null;
    if (wc.isDestroyed()) return null;
    return wc;
  }

  listTabIds(): string[] {
    return Array.from(this.tabWebContents.keys());
  }
}

// ===========================================================================
// Resolver behavior — mirrors BrowserCore.resolveWebContents contract
// ===========================================================================

describe('webcontents-resolver / existing tab', () => {
  it('returns the WebContents for an existing tab', () => {
    const resolver = new FakeBrowserCoreResolver();
    const wc = new FakeWebContentsImpl();
    resolver.addTab('tab_1', wc);
    const resolved = resolver.resolveWebContents('tab_1');
    expect(resolved).not.toBeNull();
    expect(resolved).toBe(wc);
  });

  it('returns the SAME WebContents object on repeated calls (no cloning)', () => {
    const resolver = new FakeBrowserCoreResolver();
    const wc = new FakeWebContentsImpl();
    resolver.addTab('tab_1', wc);
    const r1 = resolver.resolveWebContents('tab_1');
    const r2 = resolver.resolveWebContents('tab_1');
    expect(r1).toBe(r2);
  });

  it('returns the correct WebContents for each tab (no cross-contamination)', () => {
    const resolver = new FakeBrowserCoreResolver();
    const wc1 = new FakeWebContentsImpl();
    const wc2 = new FakeWebContentsImpl();
    resolver.addTab('tab_1', wc1);
    resolver.addTab('tab_2', wc2);
    expect(resolver.resolveWebContents('tab_1')).toBe(wc1);
    expect(resolver.resolveWebContents('tab_2')).toBe(wc2);
    expect(resolver.resolveWebContents('tab_1')).not.toBe(wc2);
  });
});

describe('webcontents-resolver / unknown tab', () => {
  it('returns null for an unknown tab id', () => {
    const resolver = new FakeBrowserCoreResolver();
    resolver.addTab('tab_1', new FakeWebContentsImpl());
    expect(resolver.resolveWebContents('unknown_tab')).toBeNull();
  });

  it('returns null for an empty string tab id', () => {
    const resolver = new FakeBrowserCoreResolver();
    expect(resolver.resolveWebContents('')).toBeNull();
  });

  it('returns null when no tabs exist', () => {
    const resolver = new FakeBrowserCoreResolver();
    expect(resolver.resolveWebContents('tab_1')).toBeNull();
  });
});

describe('webcontents-resolver / closed tab', () => {
  it('returns null after the tab is removed (closed)', () => {
    const resolver = new FakeBrowserCoreResolver();
    const wc = new FakeWebContentsImpl();
    resolver.addTab('tab_1', wc);
    expect(resolver.resolveWebContents('tab_1')).not.toBeNull();
    resolver.removeTab('tab_1');
    expect(resolver.resolveWebContents('tab_1')).toBeNull();
  });
});

describe('webcontents-resolver / destroyed WebContents', () => {
  it('returns null when the underlying WebContents is destroyed', () => {
    const resolver = new FakeBrowserCoreResolver();
    const wc = new FakeWebContentsImpl();
    resolver.addTab('tab_1', wc);
    expect(resolver.resolveWebContents('tab_1')).not.toBeNull();
    wc.destroyed = true;
    expect(resolver.resolveWebContents('tab_1')).toBeNull();
  });
});

describe('webcontents-resolver / does not change tab state', () => {
  it('resolveWebContents is a read-only accessor — calling it does not modify tab state', () => {
    const resolver = new FakeBrowserCoreResolver();
    const wc = new FakeWebContentsImpl();
    resolver.addTab('tab_1', wc);
    // Call resolve multiple times.
    resolver.resolveWebContents('tab_1');
    resolver.resolveWebContents('tab_1');
    resolver.resolveWebContents('tab_1');
    // The tab list is unchanged.
    expect(resolver.listTabIds()).toEqual(['tab_1']);
    // The WebContents object is the same (not replaced/modified).
    expect(resolver.resolveWebContents('tab_1')).toBe(wc);
  });

  it('resolver does not add or remove tabs', () => {
    const resolver = new FakeBrowserCoreResolver();
    resolver.addTab('tab_1', new FakeWebContentsImpl());
    resolver.addTab('tab_2', new FakeWebContentsImpl());
    const before = resolver.listTabIds().sort();
    resolver.resolveWebContents('tab_1');
    resolver.resolveWebContents('tab_2');
    resolver.resolveWebContents('unknown');
    const after = resolver.listTabIds().sort();
    expect(after).toEqual(before);
  });
});

// ===========================================================================
// Security boundary — WebContents accessor is NOT exposed outside main
// ===========================================================================
describe('webcontents-resolver / security boundary', () => {
  const SHARED_DIR = join(__dirname, '..', 'src', 'shared');
  const RENDERER_DIR = join(__dirname, '..', 'src', 'renderer', 'src');

  it('ExposedApi (IPC contract) does NOT contain WebContents', () => {
    const src = readFileSync(join(SHARED_DIR, 'ipc-types.ts'), 'utf8');
    expect(src).not.toMatch(/WebContents/);
  });

  it('browser-actions-types does NOT export or import WebContents as a type', () => {
    const src = readFileSync(join(SHARED_DIR, 'browser-actions-types.ts'), 'utf8');
    // WebContents may appear in comments (JSDoc), but must NOT appear in
    // import statements or type annotations.
    expect(src).not.toMatch(/import\s+.*WebContents/);
    expect(src).not.toMatch(/:\s*WebContents\b/);
    expect(src).not.toMatch(/<\s*WebContents\s*>/);
  });

  it('agent-types does NOT export or import WebContents', () => {
    const src = readFileSync(join(SHARED_DIR, 'agent-types.ts'), 'utf8');
    expect(src).not.toMatch(/import\s+.*WebContents/);
    expect(src).not.toMatch(/:\s*WebContents\b/);
    expect(src).not.toMatch(/<\s*WebContents\s*>/);
  });

  it('browser-types does NOT export or import WebContents as a type', () => {
    const src = readFileSync(join(SHARED_DIR, 'browser-types.ts'), 'utf8');
    // WebContents may appear in comments (JSDoc), but must NOT appear in
    // import statements or type annotations.
    expect(src).not.toMatch(/import\s+.*WebContents/);
    expect(src).not.toMatch(/:\s*WebContents\b/);
    expect(src).not.toMatch(/<\s*WebContents\s*>/);
  });

  it('renderer source does NOT import WebContents or resolveWebContents', () => {
    const filesToCheck = [
      'store/agent-store.ts',
      'store/browser-store.ts',
      'store/control-store.ts',
      'store/ui-logic.ts',
      'components/AgentPanel.tsx',
      'components/ControlModule.tsx',
      'components/TopBar.tsx',
      'components/CommandBar.tsx',
      'components/TabStrip.tsx',
      'components/IncognitoBadge.tsx',
      'App.tsx',
      'main.tsx',
    ];
    for (const rel of filesToCheck) {
      const src = readFileSync(join(RENDERER_DIR, rel), 'utf8');
      expect(src).not.toMatch(/WebContents/);
      expect(src).not.toMatch(/resolveWebContents/);
    }
  });
});
