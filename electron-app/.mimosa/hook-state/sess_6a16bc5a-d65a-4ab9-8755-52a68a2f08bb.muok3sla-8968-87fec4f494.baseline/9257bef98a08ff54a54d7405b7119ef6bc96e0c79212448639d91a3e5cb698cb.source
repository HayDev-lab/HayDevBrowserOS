/**
 * Vault storage adapter — file-backed store in Electron userData.
 *
 * Uses the same atomic-write pattern as HistoryStore/BookmarksStore:
 *   1. Write to a temp file.
 *   2. Rename (atomic on POSIX, overwrites on Windows).
 *
 * DEFERRED_RUNTIME: imports `node:fs` and `node:path`. Tests use
 * MemoryVaultStorageAdapter.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VaultStorageAdapter, CredentialRecord } from '@shared/vault-types';
import { validateRecord } from '../pure/vault-record-validator';

interface PersistedVault {
  version: 1;
  records: CredentialRecord[];
}

export class FileVaultStorageAdapter implements VaultStorageAdapter {
  constructor(
    private readonly filePath: string,
    private readonly baseDir: string
  ) {}

  async read(): Promise<CredentialRecord[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedVault;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.records)) {
        // Validate each record; skip corrupt ones.
        return parsed.records.filter(validateRecord);
      }
      return [];
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return [];
      // Corrupt data — return empty rather than crashing.
      return [];
    }
  }

  async write(records: CredentialRecord[]): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const payload: PersistedVault = { version: 1, records };
    const tmpPath = this.filePath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
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

export function fileVaultStorageFor(
  userDataDir: string,
  fileName: string = 'credentials.vault'
): FileVaultStorageAdapter {
  return new FileVaultStorageAdapter(
    path.join(userDataDir, fileName),
    userDataDir
  );
}
