/**
 * MemoryStore — confirmed user facts (file-backed via StorageAdapter).
 *
 * Writes happen ONLY through `confirm()` — the pending-proposal flow
 * (user confirmation in the rail) lives in the runtime layer.
 *
 * Pure logic — no Electron imports, fully testable.
 */
import type { UserFact } from '@shared/memory-types';
import { MEMORY_BOUNDS } from '@shared/memory-types';
import type { StorageAdapter } from '../../storage/storage-adapter';
interface PersistedMemory {
  version: 1;
  facts: UserFact[];
}

let _memIdCounter = 0;
function generateFactId(): string {
  _memIdCounter += 1;
  return `fact_${Date.now().toString(36)}_${_memIdCounter.toString(36)}`;
}

export class MemoryStore {
  private facts: UserFact[] = [];
  private loaded = false;

  constructor(
    private storage: StorageAdapter,
    private idGenerator: () => string = generateFactId,
    private now: () => number = () => Date.now(),
    private limit: number = MEMORY_BOUNDS.MAX_FACTS
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const raw = await this.storage.read();
    if (raw.length > 0) {
      try {
        const parsed = JSON.parse(raw) as Partial<PersistedMemory>;
        if (parsed.version === 1 && Array.isArray(parsed.facts)) {
          this.facts = parsed.facts.filter(
            (f) => f && typeof f.fact === 'string' && typeof f.id === 'string'
          );
        }
      } catch {
        this.facts = []; // corrupt file — start clean
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const payload: PersistedMemory = { version: 1, facts: this.facts };
    await this.storage.write(JSON.stringify(payload, null, 2));
  }

  /** All facts, oldest first. */
  list(): UserFact[] {
    return [...this.facts];
  }

  /** Fact texts for the system prompt (bounded count). */
  factTexts(max = 50): string[] {
    return this.facts.slice(-max).map((f) => f.fact);
  }

  /**
   * Store a confirmed fact. Normalizes whitespace, rejects empty/oversized,
   * dedupes exact repeats (returns the existing id). Evicts oldest past the
   * limit.
   */
  async confirm(rawFact: string): Promise<UserFact | null> {
    const fact = String(rawFact ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MEMORY_BOUNDS.MAX_FACT_LENGTH);
    if (!fact) return null;

    const existing = this.facts.find((f) => f.fact.toLowerCase() === fact.toLowerCase());
    if (existing) return existing;

    const record: UserFact = {
      id: this.idGenerator(),
      fact,
      createdAt: this.now(),
    };
    this.facts.push(record);
    while (this.facts.length > this.limit) {
      this.facts.shift();
    }
    await this.persist();
    return record;
  }

  async delete(id: string): Promise<boolean> {
    const before = this.facts.length;
    this.facts = this.facts.filter((f) => f.id !== id);
    if (this.facts.length === before) return false;
    await this.persist();
    return true;
  }
}
