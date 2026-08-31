/**
 * Bookmarks store — pure logic (file-backed via StorageAdapter).
 *
 * Stores bookmark entries indexed by id and url. A URL may only be
 * bookmarked once; re-adding the same URL updates the title.
 *
 * NO electron import. NO direct fs access. Fully testable.
 */
import type { Bookmark, BookmarkInput } from '@shared/browser-types';
import { canonicalizeForHistory } from '../pure/url-utils';
import type { StorageAdapter } from '../storage/storage-adapter';

export interface BookmarksStoreEvents {
  onAdded?: (bookmark: Bookmark, isNew: boolean) => void;
  onDeleted?: (id: string) => void;
  onUpdated?: (bookmark: Bookmark) => void;
}

interface PersistedBookmarks {
  version: 1;
  bookmarks: Bookmark[];
}

let _bmIdCounter = 0;
function generateBookmarkId(): string {
  _bmIdCounter += 1;
  return `bm_${Date.now().toString(36)}_${_bmIdCounter.toString(36)}`;
}

export class BookmarksStore {
  private items: Bookmark[] = [];
  private byId = new Map<string, Bookmark>();
  private byUrl = new Map<string, Bookmark>();
  private loaded = false;

  constructor(
    private storage: StorageAdapter,
    private events: BookmarksStoreEvents = {},
    private idGenerator: () => string = generateBookmarkId,
    private now: () => number = () => Date.now()
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const raw = await this.storage.read();
    if (raw.length > 0) {
      try {
        const parsed = JSON.parse(raw) as PersistedBookmarks;
        if (
          parsed &&
          parsed.version === 1 &&
          Array.isArray(parsed.bookmarks)
        ) {
          this.items = parsed.bookmarks;
          this.rebuildIndexes();
        }
      } catch {
        this.items = [];
        this.byId.clear();
        this.byUrl.clear();
      }
    }
    this.loaded = true;
  }

  async add(input: BookmarkInput): Promise<Bookmark> {
    await this.load();
    const canonical = canonicalizeForHistory(input.url);
    const existing = this.byUrl.get(canonical);
    if (existing) {
      // Update title if changed.
      if (input.title && input.title !== existing.title) {
        existing.title = input.title;
        this.events.onUpdated?.(existing);
        await this.persist();
      }
      this.events.onAdded?.(existing, false);
      return existing;
    }

    const bookmark: Bookmark = {
      id: this.idGenerator(),
      url: canonical,
      title: input.title || canonical,
      folderId: input.folderId ?? null,
      addedAt: this.now(),
    };
    this.items.push(bookmark);
    this.byId.set(bookmark.id, bookmark);
    this.byUrl.set(canonical, bookmark);
    this.events.onAdded?.(bookmark, true);
    await this.persist();
    return bookmark;
  }

  async list(): Promise<Bookmark[]> {
    await this.load();
    // Sort newest first for display.
    return [...this.items].sort((a, b) => b.addedAt - a.addedAt);
  }

  async update(
    id: string,
    patch: Partial<Pick<Bookmark, 'title' | 'url' | 'folderId'>>
  ): Promise<boolean> {
    await this.load();
    const bookmark = this.byId.get(id);
    if (!bookmark) return false;

    if (patch.title !== undefined) {
      bookmark.title = patch.title;
    }
    if (patch.url !== undefined) {
      const newCanonical = canonicalizeForHistory(patch.url);
      // If a different bookmark already has this URL, refuse.
      const other = this.byUrl.get(newCanonical);
      if (other && other.id !== bookmark.id) {
        return false;
      }
      this.byUrl.delete(bookmark.url);
      bookmark.url = newCanonical;
      this.byUrl.set(newCanonical, bookmark);
    }
    if (patch.folderId !== undefined) {
      bookmark.folderId = patch.folderId;
    }
    this.events.onUpdated?.(bookmark);
    await this.persist();
    return true;
  }

  async delete(id: string): Promise<boolean> {
    await this.load();
    const bookmark = this.byId.get(id);
    if (!bookmark) return false;
    this.byId.delete(id);
    this.byUrl.delete(bookmark.url);
    const idx = this.items.findIndex((b) => b.id === id);
    if (idx !== -1) {
      this.items.splice(idx, 1);
    }
    this.events.onDeleted?.(id);
    await this.persist();
    return true;
  }

  async has(url: string): Promise<boolean> {
    await this.load();
    return this.byUrl.has(canonicalizeForHistory(url));
  }

  async getByUrl(url: string): Promise<Bookmark | null> {
    await this.load();
    return this.byUrl.get(canonicalizeForHistory(url)) ?? null;
  }

  async search(query: string): Promise<Bookmark[]> {
    await this.load();
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return this.items
      .filter(
        (b) =>
          b.url.toLowerCase().includes(q) ||
          b.title.toLowerCase().includes(q)
      )
      .sort((a, b) => b.addedAt - a.addedAt);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private rebuildIndexes(): void {
    this.byId.clear();
    this.byUrl.clear();
    for (const b of this.items) {
      this.byId.set(b.id, b);
      // Deduplicate on load — if two entries share the same URL, keep the
      // newer one.
      const existing = this.byUrl.get(b.url);
      if (!existing || existing.addedAt < b.addedAt) {
        this.byUrl.set(b.url, b);
      }
    }
  }

  private async persist(): Promise<void> {
    const payload: PersistedBookmarks = {
      version: 1,
      bookmarks: this.items,
    };
    await this.storage.write(JSON.stringify(payload));
  }
}
