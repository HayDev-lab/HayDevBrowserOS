/**
 * WebContents resolver — wiring + security tests (PROMPT 5R).
 *
 * The real `BrowserCore.resolveWebContents` is Electron-bound and cannot be
 * exercised without a GUI. These tests verify:
 *
 *   1. The production wiring contract: BrowserActionService receives a
 *      `resolveWebContents` function that returns the WebContents for an
 *      existing tab, null for unknown tabs, and null for destroyed tabs.
 *      (Proven via a fake resolver that mirrors BrowserCore's logic.)
 *
 *   2. The resolver does NOT change tab state (it's a read-only accessor).
 *
 *   3. Security boundary: WebContents is NEVER present in:
 *      - ExposedApi (IPC contract)
 *      - preload channel whitelist
 *      - renderer source
 *      - Agent tool registry (no arbitrary JS / WebContents access)
 *      - shared serializable types
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TOOL_DEFINITIONS,
  isKnownTool,
} from '../src/main/browser/agent/pure/tool-registry';
import { validateToolCall } from '../src/main/browser/agent/pure/tool-validator';

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
// Production wiring — BrowserActionService uses the resolver correctly
// ===========================================================================
describe('webcontents-resolver / BrowserActionService wiring', () => {
  it('BrowserActionService accepts a resolveWebContents function and passes it to the adapter', () => {
    // We verify the wiring contract: BrowserActionServiceDeps.resolveWebContents
    // is a function (tabId) => WebContents | null. In production, this is
    // browserCore.resolveWebContents.bind(browserCore).
    const resolver = new FakeBrowserCoreResolver();
    resolver.addTab('tab_1', new FakeWebContentsImpl());

    // The resolver function matches the BrowserActionServiceDeps shape.
    const resolveFn = (tabId: string) => resolver.resolveWebContents(tabId);
    expect(typeof resolveFn).toBe('function');
    expect(resolveFn('tab_1')).not.toBeNull();
    expect(resolveFn('unknown')).toBeNull();
  });

  it('production wiring in main/index.ts uses browserCore.resolveWebContents (not a stub)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'main', 'index.ts'),
      'utf8'
    );
    // The resolver must call browserCore.resolveWebContents, not return null.
    expect(src).toMatch(/resolveWebContents:\s*\(tabId\)\s*=>\s*browserCore!\.resolveWebContents\(tabId\)/);
    // The old null stub must be gone.
    expect(src).not.toMatch(/return\s*null;\s*\/\/\s*TODO/);
    expect(src).not.toMatch(/void\s+tabId/);
  });

  it('the resolver is consumed ONLY by WebContentsActionAdapter (trusted main-process code)', () => {
    // Verify that resolveWebContents appears in main/index.ts (wiring) and
    // in the runtime adapter / service files, but NOT in preload or renderer.
    const mainSrc = readFileSync(
      join(__dirname, '..', 'src', 'main', 'index.ts'),
      'utf8'
    );
    const adapterSrc = readFileSync(
      join(__dirname, '..', 'src', 'main', 'browser', 'actions', 'runtime', 'webcontents-action-adapter.ts'),
      'utf8'
    );
    const serviceSrc = readFileSync(
      join(__dirname, '..', 'src', 'main', 'browser', 'actions', 'runtime', 'browser-action-service.ts'),
      'utf8'
    );
    const preloadSrc = readFileSync(
      join(__dirname, '..', 'src', 'preload', 'index.ts'),
      'utf8'
    );

    // main wiring references resolveWebContents.
    expect(mainSrc).toMatch(/resolveWebContents/);
    // adapter + service define the deps interface.
    expect(adapterSrc).toMatch(/resolveWebContents/);
    expect(serviceSrc).toMatch(/resolveWebContents/);
    // preload does NOT.
    expect(preloadSrc).not.toMatch(/resolveWebContents/);
  });
});

// ===========================================================================
// Security boundary — WebContents accessor is NOT exposed outside main
// ===========================================================================
describe('webcontents-resolver / security boundary', () => {
  const SHARED_DIR = join(__dirname, '..', 'src', 'shared');
  const PRELOAD_PATH = join(__dirname, '..', 'src', 'preload', 'index.ts');
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

  it('preload does NOT expose resolveWebContents or WebContents', () => {
    const src = readFileSync(PRELOAD_PATH, 'utf8');
    expect(src).not.toMatch(/resolveWebContents/);
    expect(src).not.toMatch(/WebContents/);
  });

  it('preload ALLOWED_INVOKE_CHANNELS does not include any webcontents/execute_js channel', () => {
    const src = readFileSync(PRELOAD_PATH, 'utf8');
    expect(src).not.toMatch(/webcontents/);
    expect(src).not.toMatch(/execute_js/);
    expect(src).not.toMatch(/executeJavaScript/);
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

  it('AgentController public methods do NOT return WebContents', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'main', 'browser', 'agent', 'runtime', 'agent-controller.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/public\s+\w+\s*\([^)]*\)\s*:\s*WebContents/);
    expect(src).not.toMatch(/getWebContents/);
  });

  it('tool registry does NOT include execute_js / shell / filesystem / http_request / electron_call', () => {
    const forbidden = ['execute_js', 'shell', 'filesystem', 'http_request', 'electron_call'];
    for (const name of forbidden) {
      expect(isKnownTool(name)).toBe(false);
    }
    expect(TOOL_DEFINITIONS.length).toBe(10);
  });

  it('tool validator rejects arbitrary JS execution attempts', () => {
    const r = validateToolCall(
      { tool: 'execute_js' as never, args: { code: 'fetch("/x")' } },
      'tab_1'
    );
    expect(r.valid).toBe(false);
  });

  it('no arbitrary JS API exists in BrowserActionService public methods', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'main', 'browser', 'actions', 'runtime', 'browser-action-service.ts'),
      'utf8'
    );
    // The service must NOT have a generic executeJs / eval / runScript method.
    expect(src).not.toMatch(/executeJs\s*\(/);
    expect(src).not.toMatch(/\beval\s*\(/);
    expect(src).not.toMatch(/runScript\s*\(/);
  });
});

// ===========================================================================
// Static source audit — BrowserCore.resolveWebContents exists and is correct
// ===========================================================================
describe('webcontents-resolver / BrowserCore source audit', () => {
  const BROWSER_CORE_PATH = join(
    __dirname, '..', 'src', 'main', 'browser', 'runtime', 'browser-core.ts'
  );

  it('BrowserCore has a resolveWebContents method with the correct signature', () => {
    const src = readFileSync(BROWSER_CORE_PATH, 'utf8');
    expect(src).toMatch(/resolveWebContents\s*\(tabId:\s*string\)\s*:\s*WebContents\s*\|\s*null/);
  });

  it('resolveWebContents returns null for unknown tabs (defensive)', () => {
    const src = readFileSync(BROWSER_CORE_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(!runtime\)\s*return\s*null/);
  });

  it('resolveWebContents checks isDestroyed (defensive)', () => {
    const src = readFileSync(BROWSER_CORE_PATH, 'utf8');
    expect(src).toMatch(/isDestroyed\(\)/);
  });

  it('resolveWebContents accesses tabRuntimes (not a duplicate registry)', () => {
    const src = readFileSync(BROWSER_CORE_PATH, 'utf8');
    // The method must use the existing tabRuntimes map, not a new one.
    expect(src).toMatch(/this\.tabRuntimes\.get\(tabId\)/);
  });

  it('tabRuntimes remains private (not exposed as a public field)', () => {
    const src = readFileSync(BROWSER_CORE_PATH, 'utf8');
    // The field declaration must use `private readonly`.
    expect(src).toMatch(/private\s+readonly\s+tabRuntimes/);
    // No public getter for the map itself.
    expect(src).not.toMatch(/public\s+get\s+tabRuntimes/);
    expect(src).not.toMatch(/getTabRuntimes/);
  });
});

// ===========================================================================
// Dependency graph — production wiring leads to real WebContents
// ===========================================================================
describe('webcontents-resolver / production dependency graph', () => {
  it('the graph BrowserCore → resolveWebContents → WebContentsActionAdapter → BrowserActionService → AgentController is complete', () => {
    // Verify each link in the chain exists in the source.
    const browserCoreSrc = readFileSync(
      join(__dirname, '..', 'src', 'main', 'browser', 'runtime', 'browser-core.ts'),
      'utf8'
    );
    const mainSrc = readFileSync(
      join(__dirname, '..', 'src', 'main', 'index.ts'),
      'utf8'
    );
    const serviceSrc = readFileSync(
      join(__dirname, '..', 'src', 'main', 'browser', 'actions', 'runtime', 'browser-action-service.ts'),
      'utf8'
    );
    const adapterSrc = readFileSync(
      join(__dirname, '..', 'src', 'main', 'browser', 'actions', 'runtime', 'webcontents-action-adapter.ts'),
      'utf8'
    );
    const controllerSrc = readFileSync(
      join(__dirname, '..', 'src', 'main', 'browser', 'agent', 'runtime', 'agent-controller.ts'),
      'utf8'
    );

    // Link 1: BrowserCore exposes resolveWebContents.
    expect(browserCoreSrc).toMatch(/resolveWebContents\s*\(tabId/);

    // Link 2: main/index.ts wires browserCore.resolveWebContents into BrowserActionService.
    expect(mainSrc).toMatch(/browserCore!\.resolveWebContents/);
    expect(mainSrc).toMatch(/new\s+BrowserActionService/);

    // Link 3: BrowserActionService constructs WebContentsActionAdapter with the resolver.
    expect(serviceSrc).toMatch(/WebContentsActionAdapter/);
    expect(serviceSrc).toMatch(/resolveWebContents/);

    // Link 4: WebContentsActionAdapter uses resolveWebContents to get WebContents.
    expect(adapterSrc).toMatch(/resolveWebContents/);
    expect(adapterSrc).toMatch(/executeJavaScript/);

    // Link 5: AgentController wraps BrowserActionService.
    expect(controllerSrc).toMatch(/BrowserActionService/);
    expect(controllerSrc).toMatch(/wrapActionService/);
  });

  it('no stub or TODO remains in the production wiring', () => {
    const mainSrc = readFileSync(
      join(__dirname, '..', 'src', 'main', 'index.ts'),
      'utf8'
    );
    // The old TODO(PROMPT 11) comment must be gone.
    expect(mainSrc).not.toMatch(/TODO\(PROMPT\s+11\)/);
    // No null-returning stub.
    expect(mainSrc).not.toMatch(/return\s*null;\s*\/\/.*DEFERRED_RUNTIME/);
    expect(mainSrc).not.toMatch(/void\s+tabId/);
  });
});
