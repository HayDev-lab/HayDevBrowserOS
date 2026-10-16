/**
 * Local dark-web document index (spec §25/§26/§27) + search history
 * (spec §65) — JSON-file backed via the project's existing atomic
 * FileStorageAdapter. No search cluster is introduced for the MVP.
 *
 * Runtime module — node:crypto-free; hashing uses the pure content-hash.
 */
import { contentHash, normalizeTextForHash } from '../pure/content-hash';
import { extractQueryTerms } from '../pure/rank';
import type { StorageAdapter } from '../../storage/storage-adapter';

export interface DarkWebDocument {
  id: string;
  url: string;
  host: string;
  title: string;
  text: string;
  contentHash: string;
  fetchedAt: number;
  provider: string | null;
  crawlJobId: string | null;
}

export interface LocalIndexSearchHit {
  id: string;
  url: string;
  host: string;
  title: string;
  snippet: string;
  fetchedAt: number;
  score: number;
}

const INDEX_MAX_BYTES = 8 * 1024 * 1024; // ~8 MiB on disk before trimming
const AVG_DOC_BYTES = 8_000; // heuristic for pre-trim document cap

export class DarkWebLocalIndex {
  private docs: DarkWebDocument[] = [];
  private byHash = new Set<string>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly maxDocs: number = Math.max(50, Math.floor(INDEX_MAX_BYTES / AVG_DOC_BYTES)),
    private readonly genId: () => string = () => `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const raw = await this.storage.read();
          if (raw.trim().length > 0) {
            const parsed = JSON.parse(raw) as { docs?: DarkWebDocument[] };
            for (const d of parsed.docs ?? []) {
              if (typeof d?.url === 'string' && typeof d?.contentHash === 'string') {
                this.docs.push(d);
                this.byHash.add(d.contentHash);
              }
            }
            this.sortByFetchedAt();
          }
        } catch {
          // Corrupt/absent index → start empty; never crash the app on read.
          this.docs = [];
          this.byHash = new Set();
        }
        this.loaded = true;
      })();
    }
    return this.loadPromise;
  }

  async reload(): Promise<void> {
    this.docs = [];
    this.byHash = new Set();
    this.loaded = false;
    this.loadPromise = null;
    await this.load();
  }

  private sortByFetchedAt(): void {
    this.docs.sort((a, b) => b.fetchedAt - a.fetchedAt);
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify({ version: 1, docs: this.docs });
    await this.storage.write(payload);
  }

  /**
   * Add a document. Content-hash dedup: an identical (normalized) text
   * already indexed is skipped — returns added=false/duplicate.
   */
  async add(doc: Omit<DarkWebDocument, 'id' | 'contentHash'> & { text: string }): Promise<{ added: boolean; reason: string | null; id: string | null }> {
    await this.load();
    const normalized = normalizeTextForHash(doc.text);
    if (normalized.length === 0) return { added: false, reason: 'empty_text', id: null };
    const hash = contentHash(doc.text);
    if (this.byHash.has(hash)) return { added: false, reason: 'duplicate_content', id: null };

    const record: DarkWebDocument = {
      id: this.genId(),
      url: doc.url,
      host: doc.host,
      title: doc.title,
      text: doc.text,
      contentHash: hash,
      fetchedAt: doc.fetchedAt,
      provider: doc.provider,
      crawlJobId: doc.crawlJobId,
    };
    this.docs.unshift(record);
    this.byHash.add(hash);
    this.trimToCap();
    try {
      await this.persist();
    } catch (err) {
      // Keep the in-memory doc; persistence failure must not break the job.
      return { added: true, reason: `persist_failed:${err instanceof Error ? err.message : 'unknown'}`, id: record.id };
    }
    return { added: true, reason: null, id: record.id };
  }

  private trimToCap(): void {
    if (this.docs.length <= this.maxDocs) return;
    const removed = this.docs.splice(this.maxDocs);
    for (const d of removed) this.byHash.delete(d.contentHash);
  }

  /** Keyword scoring: title×3, text×1, url×1. LLM-free by design. */
  async search(query: string, limit: number): Promise<LocalIndexSearchHit[]> {
    await this.load();
    const terms = extractQueryTerms(query);
    if (terms.length === 0) return [];
    const hits: LocalIndexSearchHit[] = [];
    for (const d of this.docs) {
      const title = d.title.toLowerCase();
      const text = d.text.toLowerCase();
      const url = d.url.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 3;
        if (url.includes(t)) score += 1;
        if (text.includes(t)) score += 1;
      }
      // Require at least one term somewhere; scoring provides ordering.
      if (score === 0) continue;
      const snippetAt = text.indexOf(terms[0]);
      const snippet = snippetAt >= 0
        ? d.text.slice(Math.max(0, snippetAt - 60), snippetAt + 160).trim()
        : d.text.slice(0, 160).trim();
      hits.push({
        id: d.id,
        url: d.url,
        host: d.host,
        title: d.title || d.url,
        snippet,
        fetchedAt: d.fetchedAt,
        score,
      });
    }
    hits.sort((a, b) => b.score - a.score || b.fetchedAt - a.fetchedAt);
    return hits.slice(0, Math.max(1, limit));
  }

  async clear(): Promise<void> {
    await this.load();
    this.docs = [];
    this.byHash = new Set();
    await this.storage.write('');
  }

  async size(): Promise<number> {
    await this.load();
    return this.docs.length;
  }
}

// ---------------------------------------------------------------------------
// Search history (spec §41/§65) — query + providers + timestamp ONLY.
// ---------------------------------------------------------------------------

export interface DarkWebHistoryEntry {
  query: string;
  providers: string[];
  at: number;
}

const HISTORY_CAP = 200;

export class DarkWebSearchHistory {
  private entries: DarkWebHistoryEntry[] = [];
  private loaded = false;

  constructor(private readonly storage: StorageAdapter) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await this.storage.read();
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw) as { entries?: DarkWebHistoryEntry[] };
        this.entries = (parsed.entries ?? []).filter((e) => typeof e?.query === 'string');
      }
    } catch {
      this.entries = [];
    }
  }

  async add(query: string, providers: string[], at = Date.now()): Promise<void> {
    await this.load();
    this.entries.unshift({ query, providers, at });
    if (this.entries.length > HISTORY_CAP) this.entries.length = HISTORY_CAP;
    try {
      await this.storage.write(JSON.stringify({ version: 1, entries: this.entries }));
    } catch {
      // Best-effort persistence.
    }
  }

  async list(): Promise<DarkWebHistoryEntry[]> {
    await this.load();
    return [...this.entries];
  }

  async clear(): Promise<void> {
    await this.load();
    this.entries = [];
    await this.storage.write('');
  }
}
