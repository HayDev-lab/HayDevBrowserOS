/**
 * Storage adapter interface.
 *
 * Used by HistoryStore and BookmarksStore to abstract away file system
 * access so the stores can be unit-tested without touching the disk.
 *
 * The runtime side uses `FileStorageAdapter` (Node `fs`). Tests use
 * `MemoryStorageAdapter`.
 */
export interface StorageAdapter {
  /** Read the raw stored string. Returns empty string if no data exists. */
  read(): Promise<string>;
  /** Write the raw string. Must atomically replace existing data. */
  write(data: string): Promise<void>;
  /** Return true if storage is available (file/dir exists). */
  exists(): Promise<boolean>;
}

/**
 * In-memory storage adapter — for unit tests.
 *
 * Optional `seed` initialises the buffer (e.g. with a corrupt JSON payload
 * to exercise the store's recovery path).
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private buffer: string;
  public writes: number = 0;
  public reads: number = 0;
  public failNextWrite: boolean = false;
  public failNextRead: boolean = false;

  constructor(seed: string = '') {
    this.buffer = seed;
  }

  async read(): Promise<string> {
    this.reads += 1;
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error('MemoryStorageAdapter: simulated read failure');
    }
    return this.buffer;
  }

  async write(data: string): Promise<void> {
    this.writes += 1;
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('MemoryStorageAdapter: simulated write failure');
    }
    this.buffer = data;
  }

  async exists(): Promise<boolean> {
    return this.buffer.length > 0;
  }

  /** Test helper — peek at the current buffer. */
  peek(): string {
    return this.buffer;
  }
}
