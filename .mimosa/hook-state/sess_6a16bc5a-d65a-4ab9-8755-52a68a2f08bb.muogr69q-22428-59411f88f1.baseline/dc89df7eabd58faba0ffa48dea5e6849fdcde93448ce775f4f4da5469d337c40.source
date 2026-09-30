/**
 * Encryption adapter — production impl using Electron safeStorage.
 *
 * DEFERRED_RUNTIME: imports `electron`. Tests inject a FakeEncryptionAdapter.
 *
 * SECURITY:
 *   - `safeStorage.encryptString(plaintext)` returns a Buffer that is
 *     encrypted with the OS-level key (DPAPI on Windows, Keychain on macOS,
 *     libsecret on Linux).
 *   - `safeStorage.decryptString(buffer)` returns the plaintext.
 *   - The plaintext is NEVER stored — only the encrypted base64 string.
 *   - `isEncryptionAvailable()` returns false if the OS doesn't support
 *     safeStorage (e.g. headless Linux without libsecret).
 */
import { safeStorage } from 'electron';
import type { EncryptionAdapter } from '@shared/vault-types';

export class SafeStorageEncryptionAdapter implements EncryptionAdapter {
  encryptString(plaintext: string): string {
    if (!this.isEncryptionAvailable()) {
      throw new Error('SAFE_STORAGE_UNAVAILABLE');
    }
    const encrypted = safeStorage.encryptString(plaintext);
    return encrypted.toString('base64');
  }

  decryptString(encrypted: string): string {
    if (!this.isEncryptionAvailable()) {
      throw new Error('SAFE_STORAGE_UNAVAILABLE');
    }
    const buf = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buf);
  }

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }
}
