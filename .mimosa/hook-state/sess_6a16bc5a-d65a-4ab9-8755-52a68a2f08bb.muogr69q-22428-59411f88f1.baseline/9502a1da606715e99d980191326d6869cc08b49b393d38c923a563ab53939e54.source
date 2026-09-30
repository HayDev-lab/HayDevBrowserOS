/**
 * ResearchSourceLedger — pure, in-memory record of ACTUALLY visited sources.
 *
 * Recording is deterministic (done by the runtime recorder from real
 * navigate/readPage results), never model-decided — so every report URL is
 * backed by a page the browser really loaded.
 *
 * Rules:
 *   - a source is keyed by its CANONICAL URL (dedup);
 *   - revisiting updates title/excerpt (latest read wins) but keeps the
 *     original id/order;
 *   - failed loads are recorded with status 'failed' (never cited);
 *   - MAX_SOURCES is a hard bound — excess sources are refused (the caller
 *     treats this as "evidence collection complete").
 *   - excerpts are size-capped (page content is UNTRUSTED DATA).
 *
 * Pure logic — no Electron, no persistence.
 */
import { RESEARCH_BOUNDS, type ResearchSource } from '@shared/research-types';
import { canonicalizeResearchUrl } from './url-canonicalizer';

export interface RecordSourceInput {
  url: string;
  title: string;
  /** Bounded visible-text digest (already clamped by the recorder). */
  excerpt?: string;
  failed?: boolean;
  now?: number;
}

export type LedgerRecordOutcome =
  | { kind: 'added'; source: ResearchSource }
  | { kind: 'updated'; source: ResearchSource }
  | { kind: 'duplicate-visited'; source: ResearchSource }
  | { kind: 'marked-failed'; source: ResearchSource }
  | { kind: 'limit-reached' };

export class ResearchSourceLedger {
  private readonly sources = new Map<string, ResearchSource>();
  private orderCounter = 0;

  /** Visited sources only (citable). */
  listVisited(): ResearchSource[] {
    return this.list().filter((s) => s.status === 'visited');
  }

  /** All recorded sources, in arrival order (visited + failed). */
  list(): ResearchSource[] {
    return [...this.sources.values()].sort((a, b) => a.order - b.order);
  }

  size(): number {
    return this.sources.size;
  }

  /** Find a citable source by id (visited only). */
  byId(id: number): ResearchSource | null {
    const hit = this.list().find((s) => s.id === id);
    return hit && hit.status === 'visited' ? hit : null;
  }

  /** Find a citable source by raw-or-canonical URL match. */
  byUrl(url: string): ResearchSource | null {
    const canonical = canonicalizeResearchUrl(url);
    const hit = this.list().find((s) => s.url === canonical);
    return hit && hit.status === 'visited' ? hit : null;
  }

  /**
   * Record a source from a real browser read (or a real failed load).
   * Returns the outcome so the recorder can report what happened.
   */
  record(input: RecordSourceInput): LedgerRecordOutcome {
    const canonical = canonicalizeResearchUrl(input.url);
    const now = input.now ?? 0;
    const excerpt = clampExcerpt(input.excerpt ?? '');

    const existing = this.sources.get(canonical);
    if (existing) {
      if (input.failed) {
        if (existing.status === 'failed') return { kind: 'duplicate-visited', source: existing };
        const updated: ResearchSource = { ...existing, status: 'failed', excerpt: '' };
        this.sources.set(canonical, updated);
        return { kind: 'marked-failed', source: updated };
      }
      if (existing.status === 'failed') {
        const recovered: ResearchSource = {
          ...existing,
          status: 'visited',
          title: input.title || existing.title,
          excerpt,
        };
        this.sources.set(canonical, recovered);
        return { kind: 'updated', source: recovered };
      }
      if (existing.title !== input.title || existing.excerpt !== excerpt) {
        const updated: ResearchSource = {
          ...existing,
          title: input.title || existing.title,
          excerpt: excerpt || existing.excerpt,
        };
        this.sources.set(canonical, updated);
        return { kind: 'updated', source: updated };
      }
      return { kind: 'duplicate-visited', source: existing };
    }

    if (this.sources.size >= RESEARCH_BOUNDS.MAX_SOURCES) {
      return { kind: 'limit-reached' };
    }

    this.orderCounter += 1;
    const source: ResearchSource = {
      id: this.orderCounter,
      url: canonical,
      rawUrl: input.url,
      title: input.title,
      status: input.failed ? 'failed' : 'visited',
      excerpt: input.failed ? '' : excerpt,
      order: this.orderCounter,
      visitedAt: now,
    };
    this.sources.set(canonical, source);
    return { kind: input.failed ? 'marked-failed' : 'added', source };
  }
}

function clampExcerpt(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, RESEARCH_BOUNDS.MAX_EXCERPT_LENGTH);
}
