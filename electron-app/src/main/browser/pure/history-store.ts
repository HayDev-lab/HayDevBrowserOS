/**
 * History store — pure logic (file-backed via StorageAdapter).
 *
 * Records visit entries per URL. The same URL visited multiple times
 * increments `visitCount` and updates `visitedAt` to the latest visit.
 *
 * NO electron import. NO direct fs access. The store is fully testable.
 */
import type { HistoryEntry, HistoryQuery } from '@shared/browser-types';
import { canonicalizeForHistory } from '../pure/url-utils';
import type { StorageAdapter } from '../storage/storage-adapter';

const HISTORY_LIMIT = 10_000;

export interface HistoryStoreEvents {
  onAdded?: (entry: HistoryEntry, isNew: boolean) => void;
  onCleared?: () => void;
  onDeleted?: (id: string) => void;
}

interface PersistedHistory {
  version: 1;
  entries: HistoryEntry[];
}

let _histIdCounter = 0;
function generateHistoryId(): string {
  _histIdCounter += 1;
  return `hist_${Date.now().toString(36)}_${_histIdCounter.toString(36)}`;
}

export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private urlIndex = new Map<string, HistoryEntry>();
  private loaded = false;

  constructor(
    private storage: StorageAdapter,
    private events: HistoryStoreEvents = {},
    private idGenerator: () => string = generateHistoryId,
    private now: () => number = () => Date.now(),
    private limit: number = HISTORY_LIMIT
  ) {}

  /** Lazily load the persisted state from storage. */
  async load(): Promise<void> {
    if (this.loaded) return;
    const raw = await this.storage.read();
    if (raw.length > 0) {
      try {
        const parsed = JSON.parse(raw) as PersistedHistory;
        if (
          parsed &&
          parsed.version === 1 &&
          Array.isArray(parsed.entries)
        ) {
          this.entries = parsed.entries;
          this.rebuildIndex();
        }
      } catch {
        // Corrupt data — start empty. We deliberately do NOT auto-clear
        // the file in case the user wants to recover it manually.
        this.entries = [];
        this.urlIndex.clear();
      }
    }
    this.loaded = true;
  }

  /**
   * Add a visit. If the URL already exists, increments visitCount and updates
   * visitedAt. Returns the resulting HistoryEntry.
   */
  async add(input: {
    url: string;
    title: string;
    visitedAt?: number;
  }): Promise<HistoryEntry> {
    await this.load();
    const canonical = canonicalizeForHistory(input.url);
    const visitedAt = input.visitedAt ?? this.now();
    const existing = this.urlIndex.get(canonical);

    if (existing) {
      existing.visitedAt = visitedAt;
      existing.visitCount += 1;
      // Update the title only if the new one is non-empty and different.
      if (input.title && input.title !== existing.title) {
        existing.title = input.title;
      }
      this.events.onAdded?.(existing, false);
      await this.persist();
      return existing;
    }

    const entry: HistoryEntry = {
      id: this.idGenerator(),
      url: canonical,
      title: input.title || canonical,
      visitedAt,
      visitCount: 1,
    };
    this.entries.push(entry);
    this.urlIndex.set(canonical, entry);
    this.enforceLimit();
    this.events.onAdded?.(entry, true);
    await this.persist();
    return entry;
  }

  /** Query history entries, newest first by default. */
  async query(q: HistoryQuery = {}): Promise<HistoryEntry[]> {
    await this.load();
    const limit = q.limit ?? 100;
    const since = q.since ?? 0;
    const search = q.search?.toLowerCase().trim();

    const filtered = this.entries.filter((e) => {
      if (e.visitedAt < since) return false;
      if (search) {
        if (
          !e.url.toLowerCase().includes(search) &&
          !e.title.toLowerCase().includes(search)
        ) {
          return false;
        }
      }
      return true;
    });

    // Sort newest first.
    filtered.sort((a, b) => b.visitedAt - a.visitedAt);
    return filtered.slice(0, limit);
  }

  /** Delete a single entry by id. Returns true if found. */
  async delete(id: string): Promise<boolean> {
    await this.load();
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    const [removed] = this.entries.splice(idx, 1);
    this.urlIndex.delete(removed.url);
    this.events.onDeleted?.(id);
    await this.persist();
    return true;
  }

  /** Clear all history. */
  async clear(): Promise<void> {
    await this.load();
    this.entries = [];
    this.urlIndex.clear();
    this.events.onCleared?.();
    await this.persist();
  }

  /** Check whether a URL is in history (canonicalized). */
  async has(url: string): Promise<boolean> {
    await this.load();
    return this.urlIndex.has(canonicalizeForHistory(url));
  }

  /** Get a single entry by URL. */
  async getByUrl(url: string): Promise<HistoryEntry | null> {
    await this.load();
    return this.urlIndex.get(canonicalizeForHistory(url)) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private rebuildIndex(): void {
    this.urlIndex.clear();
    for (const e of this.entries) {
      this.urlIndex.set(e.url, e);
    }
  }

  private enforceLimit(): void {
    if (this.entries.length <= this.limit) return;
    // Drop oldest entries by visitedAt.
    this.entries.sort((a, b) => b.visitedAt - a.visitedAt);
    const kept = this.entries.slice(0, this.limit);
    const dropped = this.entries.slice(this.limit);
    for (const d of dropped) {
      this.urlIndex.delete(d.url);
    }
    this.entries = kept;
  }

  private async persist(): Promise<void> {
    const payload: PersistedHistory = {
      version: 1,
      entries: this.entries,
    };
    await this.storage.write(JSON.stringify(payload));
  }
}
