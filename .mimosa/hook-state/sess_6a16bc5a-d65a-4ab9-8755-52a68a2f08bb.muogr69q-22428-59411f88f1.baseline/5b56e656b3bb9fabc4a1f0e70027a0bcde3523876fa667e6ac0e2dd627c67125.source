/**
 * File-backed storage adapter.
 *
 * Uses Node `fs/promises` for async disk access. Persists data atomically
 * by writing to a temp file then renaming, so a crash mid-write cannot
 * corrupt the existing data.
 *
 * This module imports `node:fs` and `node:path`, so it is NOT safe to import
 * from unit tests that run in a pure-logic environment — use
 * `MemoryStorageAdapter` there.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export class FileStorageAdapter {
  constructor(
    private readonly filePath: string,
    private readonly baseDir: string
  ) {}

  async read(): Promise<string> {
    try {
      return await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return '';
      throw err;
    }
  }

  async write(data: string): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const tmpPath = this.filePath + '.tmp';
    await fs.writeFile(tmpPath, data, 'utf8');
    // `rename` is atomic on POSIX; on Windows it overwrites the destination.
    await fs.rename(tmpPath, this.filePath);
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Build a FileStorageAdapter anchored at `userData/history.json` (or similar).
 * Caller supplies the file name; the base directory is the app's userData.
 */
export function fileStorageFor(
  userDataDir: string,
  fileName: string
): FileStorageAdapter {
  return new FileStorageAdapter(
    path.join(userDataDir, fileName),
    userDataDir
  );
}
