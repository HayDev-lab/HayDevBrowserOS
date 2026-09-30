/**
 * Fake encryption + storage adapters for vault tests.
 *
 * Test fixtures only — NOT production fallback.
 */
import type {
  EncryptionAdapter,
  VaultStorageAdapter,
  CredentialRecord,
} from '@shared/vault-types';
import { validateRecord } from '../src/main/browser/vault/pure/vault-record-validator';

// ---------------------------------------------------------------------------
// FakeEncryptionAdapter — XOR-based encryption (obviously NOT secure, but
// sufficient for testing the vault logic without real safeStorage).
// ---------------------------------------------------------------------------

export class FakeEncryptionAdapter implements EncryptionAdapter {
  public readonly encryptCalls: string[] = [];
  public readonly decryptCalls: string[] = [];

  encryptString(plaintext: string): string {
    this.encryptCalls.push(plaintext);
    // Simple XOR + base64 — NOT secure, just for testing.
    const buf = Buffer.from(plaintext, 'utf8');
    for (let i = 0; i < buf.length; i++) {
      buf[i] = buf[i]! ^ 0x42;
    }
    return buf.toString('base64');
  }

  decryptString(encrypted: string): string {
    this.decryptCalls.push(encrypted);
    const buf = Buffer.from(encrypted, 'base64');
    for (let i = 0; i < buf.length; i++) {
      buf[i] = buf[i]! ^ 0x42;
    }
    return buf.toString('utf8');
  }

  isEncryptionAvailable(): boolean {
    return true;
  }

  /** Test helper: verify that the encrypted value does NOT contain the plaintext. */
  encryptedValueContainsPlaintext(encrypted: string, plaintext: string): boolean {
    return encrypted.includes(plaintext);
  }
}

// ---------------------------------------------------------------------------
// FakeUnavailableEncryptionAdapter — simulates safeStorage not available.
// ---------------------------------------------------------------------------

export class FakeUnavailableEncryptionAdapter implements EncryptionAdapter {
  encryptString(_plaintext: string): string {
    throw new Error('SAFE_STORAGE_UNAVAILABLE');
  }

  decryptString(_encrypted: string): string {
    throw new Error('SAFE_STORAGE_UNAVAILABLE');
  }

  isEncryptionAvailable(): boolean {
    return false;
  }
}

// ---------------------------------------------------------------------------
// MemoryVaultStorageAdapter — in-memory vault storage for tests.
// ---------------------------------------------------------------------------

export class MemoryVaultStorageAdapter implements VaultStorageAdapter {
  private buffer: CredentialRecord[] = [];
  public writes = 0;
  public reads = 0;
  public failNextWrite = false;
  public seedCorrupt = false;

  constructor(seed: CredentialRecord[] = []) {
    this.buffer = [...seed];
  }

  async read(): Promise<CredentialRecord[]> {
    this.reads += 1;
    if (this.seedCorrupt) {
      return [{ invalid: true } as unknown as CredentialRecord];
    }
    return this.buffer.filter(validateRecord);
  }

  async write(records: CredentialRecord[]): Promise<void> {
    this.writes += 1;
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('write_failed');
    }
    this.buffer = [...records];
  }

  async exists(): Promise<boolean> {
    return this.buffer.length > 0;
  }

  /** Test helper: peek at the raw buffer (including invalid records). */
  peekRaw(): CredentialRecord[] {
    return this.buffer;
  }

  /** Test helper: check if any record contains a plaintext password. */
  containsPlaintext(plaintext: string): boolean {
    return this.buffer.some((r) =>
      JSON.stringify(r).includes(plaintext)
    );
  }
}
