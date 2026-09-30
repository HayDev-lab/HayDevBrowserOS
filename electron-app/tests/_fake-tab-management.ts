/**
 * Fake TabManagementPort — test fixture.
 *
 * Implements `TabManagementPort` (the minimal BrowserCore surface consumed
 * by the action router). Does NOT use Electron.
 */
import type { TabState } from '@shared/browser-types';
import type { TabManagementPort } from '../src/main/browser/actions/pure/action-router';

export class FakeTabManagement implements TabManagementPort {
  private tabs = new Map<string, TabState>();
  private nextId = 1;

  constructor(initial: TabState[] = []) {
    for (const t of initial) {
      this.tabs.set(t.id, t);
    }
  }

  listTabs(): TabState[] {
    return Array.from(this.tabs.values());
  }

  openTab(opts: { url?: string; activate?: boolean; incognito?: boolean }): string {
    const id = `fake_tab_${this.nextId++}`;
    const tab: TabState = {
      id,
      url: '',
      pendingUrl: opts.url ?? '',
      title: opts.url ?? 'New Tab',
      loadState: 'idle',
      error: null,
      canGoBack: false,
      canGoForward: false,
      isIncognito: !!opts.incognito,
      isActive: !!opts.activate,
      isAudioPlaying: false,
      unreadCount: 0,
      isDiscarded: false,
      createdAt: Date.now(),
      lastActivatedAt: Date.now(),
    };
    this.tabs.set(id, tab);
    return id;
  }

  activateTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;
    for (const t of this.tabs.values()) {
      t.isActive = false;
    }
    tab.isActive = true;
    return true;
  }

  closeTab(tabId: string): boolean {
    return this.tabs.delete(tabId);
  }

  hasTab(tabId: string): boolean {
    return this.tabs.has(tabId);
  }

  /** Test helper: add a tab with a specific id. */
  addTab(tab: TabState): void {
    this.tabs.set(tab.id, tab);
  }

  /** Test helper: get a tab by id. */
  getTab(tabId: string): TabState | undefined {
    return this.tabs.get(tabId);
  }
}

export function makeFakeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab_1',
    url: 'https://example.com/',
    pendingUrl: 'https://example.com/',
    title: 'Example',
    loadState: 'committed',
    error: null,
    canGoBack: false,
    canGoForward: false,
    isIncognito: false,
    isActive: true,
    isAudioPlaying: false,
      unreadCount: 0,
      isDiscarded: false,
    createdAt: 1_000_000,
    lastActivatedAt: 1_000_000,
    ...overrides,
  };
}
