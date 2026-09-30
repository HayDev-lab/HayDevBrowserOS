/**
 * SessionStore — pure logic for persisting/restoring the browser session
 * (open tabs + their navigation stacks) across app restarts.
 *
 * NO electron import. NO direct fs access. Fully unit-testable via
 * `StorageAdapter` (MemoryStorageAdapter in tests, FileStorageAdapter at
 * runtime).
 *
 * PRIVACY: incognito tabs are NEVER persisted. The store filters them out
 * on save and never restores them. This is enforced here (pure layer) so
 * the guarantee holds regardless of runtime wiring.
 */
import type { SessionSnapshot, SessionTab } from '@shared/browser-types';
import type { StorageAdapter } from '../storage/storage-adapter';

export interface SessionStoreEvents {
  onSaved?: (snapshot: SessionSnapshot) => void;
  onLoaded?: (snapshot: SessionSnapshot) => void;
}

export class SessionStore {
  private loaded = false;
  private snapshot: SessionSnapshot | null = null;

  constructor(
    private storage: StorageAdapter,
    private events: SessionStoreEvents = {}
  ) {}

  /** Lazily load the persisted session from storage. */
  async load(): Promise<SessionSnapshot | null> {
    if (this.loaded) return this.snapshot;
    const raw = await this.storage.read();
    if (raw.length > 0) {
      try {
        const parsed = JSON.parse(raw) as SessionSnapshot;
        if (
          parsed &&
          parsed.version === 1 &&
          Array.isArray(parsed.tabs) &&
          Array.isArray(parsed.order)
        ) {
          // Filter out any incognito tabs that may have slipped in (defensive).
          const nonIncognito = parsed.tabs.filter((t) => !t.isIncognito);
          const validIds = new Set(nonIncognito.map((t) => t.id));
          this.snapshot = {
            version: 1,
            tabs: nonIncognito,
            order: parsed.order.filter((id) => validIds.has(id)),
            activeId:
              parsed.activeId && validIds.has(parsed.activeId)
                ? parsed.activeId
                : nonIncognito.length > 0
                  ? nonIncognito[0].id
                  : null,
          };
          this.events.onLoaded?.(this.snapshot);
        }
      } catch {
        // Corrupt data — start empty (do NOT auto-clear the file).
        this.snapshot = null;
      }
    }
    this.loaded = true;
    return this.snapshot;
  }

  /**
   * Persist the session. Incognito tabs are filtered out before writing.
   * Returns the snapshot that was actually written (post-filter).
   */
  async save(snapshot: SessionSnapshot): Promise<SessionSnapshot> {
    const filtered: SessionSnapshot = {
      version: 1,
      tabs: snapshot.tabs.filter((t) => !t.isIncognito),
      order: snapshot.order.filter((id) =>
        snapshot.tabs.some((t) => t.id === id && !t.isIncognito)
      ),
      activeId:
        snapshot.activeId &&
        snapshot.tabs.some((t) => t.id === snapshot.activeId && !t.isIncognito)
          ? snapshot.activeId
          : null,
    };
    this.snapshot = filtered;
    await this.storage.write(JSON.stringify(filtered));
    this.events.onSaved?.(filtered);
    return filtered;
  }

  /** The last loaded/saved snapshot (or null). */
  current(): SessionSnapshot | null {
    return this.snapshot;
  }

  /** True if a session was loaded from disk. */
  hasLoaded(): boolean {
    return this.loaded;
  }
}

/**
 * Build a `SessionTab` from a tab's current state + navigation snapshot.
 * Pure helper so the runtime (BrowserCore) stays thin.
 */
export function buildSessionTab(
  tab: {
    id: string;
    url: string;
    pendingUrl: string;
    title: string;
    isIncognito: boolean;
  },
  navigation: { backStack: string[]; current: string | null; forwardStack: string[] }
): SessionTab {
  return {
    id: tab.id,
    url: tab.url,
    pendingUrl: tab.pendingUrl,
    title: tab.title,
    isIncognito: tab.isIncognito,
    navigation: {
      backStack: [...navigation.backStack],
      current: navigation.current,
      forwardStack: [...navigation.forwardStack],
    },
  };
}
