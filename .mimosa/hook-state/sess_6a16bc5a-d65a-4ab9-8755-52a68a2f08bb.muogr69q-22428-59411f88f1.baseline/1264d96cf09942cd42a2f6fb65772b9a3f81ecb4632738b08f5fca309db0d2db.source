/**
 * Test helper — deterministic id generator and clock for unit tests.
 *
 * Exported from tests/ so individual test files can import it without
 * touching the production source tree.
 */
import { MemoryStorageAdapter } from '../src/main/browser/storage/storage-adapter';

export function makeIdGen(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}_${n.toString(36)}`;
  };
}

export function makeClock(start = 1_000_000): () => number {
  let t = start;
  return () => {
    t += 1_000;
    return t;
  };
}

export function memoryStorage(): MemoryStorageAdapter {
  return new MemoryStorageAdapter();
}

/**
 * Vitest-compatible test scaffold. We import { describe, it, expect, beforeEach }
 * explicitly in each test file rather than relying on globals, so `globals: false`
 * is safe.
 */
export { describe, it, expect, beforeEach, afterEach } from 'vitest';
