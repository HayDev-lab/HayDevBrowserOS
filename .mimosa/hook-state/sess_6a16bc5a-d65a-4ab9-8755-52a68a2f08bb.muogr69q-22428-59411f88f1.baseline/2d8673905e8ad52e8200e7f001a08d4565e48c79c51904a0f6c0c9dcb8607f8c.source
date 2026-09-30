import { describe, it, expect, beforeEach } from 'vitest';
import { CredentialVault } from '../src/main/browser/vault/runtime/credential-vault';
import {
  FakeEncryptionAdapter,
  MemoryVaultStorageAdapter,
  FakeUnavailableEncryptionAdapter,
} from './_fake-vault';
import { makeClock } from './_helpers';
import type { WebContents } from 'electron';

// Fake WebContents for fill tests
class FakeFillWebContents {
  public destroyed = false;
  public readonly filledScripts: string[] = [];
  public fillResult = { usernameFilled: true, passwordFilled: true };

  isDestroyed(): boolean { return this.destroyed; }
  async executeJavaScript(script: string, _userGesture: boolean): Promise<unknown> {
    this.filledScripts.push(script);
    return this.fillResult;
  }
}

function setup() {
  const encryption = new FakeEncryptionAdapter();
  const storage = new MemoryVaultStorageAdapter();
  const fakeWc = new FakeFillWebContents();
  const vault = new CredentialVault({
    encryption,
    storage,
    resolveWebContents: (tabId) => (tabId === 'tab_1' ? fakeWc as unknown as WebContents : null),
    now: makeClock(1_000_000),
  });
  return { vault, encryption, storage, fakeWc };
}

// ===========================================================================
// save
// ===========================================================================
describe('credential-vault / save', () => {
  it('saves a new credential and returns metadata (no password)', async () => {
    const { vault } = setup();
    const result = await vault.save({
      domain: 'example.com',
      username: 'user@example.com',
      password: 'supersecret123',
    });
    expect(result.success).toBe(true);
    expect(result.credential).toBeDefined();
    expect(result.credential!.domain).toBe('example.com');
    expect(result.credential!.username).toBe('user@example.com');
    // MUST NOT contain encryptedPassword or password.
    expect((result.credential as unknown as Record<string, unknown>).encryptedPassword).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).password).toBeUndefined();
  });

  it('encrypts the password before storing', async () => {
    const { vault, encryption, storage } = setup();
    await vault.save({
      domain: 'example.com',
      username: 'user@example.com',
      password: 'supersecret123',
    });
    expect(encryption.encryptCalls).toContain('supersecret123');
    // Verify the stored record contains encrypted password, NOT plaintext.
    const records = await storage.read();
    expect(records[0]!.encryptedPassword).not.toBe('supersecret123');
  });

  it('updates existing record (same domain + username)', async () => {
    const { vault, storage } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'oldpassword123' });
    await vault.save({ domain: 'example.com', username: 'user', password: 'newpassword123' });
    const records = await storage.read();
    expect(records.length).toBe(1); // Not duplicated
  });

  it('stores separate records for different domains/usernames', async () => {
    const { vault, storage } = setup();
    await vault.save({ domain: 'example.com', username: 'user1', password: 'password1234' });
    await vault.save({ domain: 'google.com', username: 'user2', password: 'password5678' });
    const records = await storage.read();
    expect(records.length).toBe(2);
  });
});

// ===========================================================================
// has
// ===========================================================================
describe('credential-vault / has', () => {
  it('returns true for a stored domain', async () => {
    const { vault } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    const result = await vault.has({ domain: 'example.com' });
    expect(result.has).toBe(true);
    expect(result.credential).toBeDefined();
  });

  it('returns true for a subdomain of a stored domain', async () => {
    const { vault } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    const result = await vault.has({ domain: 'login.example.com' });
    expect(result.has).toBe(true);
  });

  it('returns false for an unstored domain', async () => {
    const { vault } = setup();
    const result = await vault.has({ domain: 'google.com' });
    expect(result.has).toBe(false);
  });

  it('returns false for evil-example.com (anti-malicious-suffix)', async () => {
    const { vault } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    const result = await vault.has({ domain: 'evil-example.com' });
    expect(result.has).toBe(false);
  });

  it('returns false for an invalid domain', async () => {
    const { vault } = setup();
    const result = await vault.has({ domain: 'localhost' });
    expect(result.has).toBe(false);
  });
});

// ===========================================================================
// list
// ===========================================================================
describe('credential-vault / list', () => {
  it('returns all stored credentials as metadata (no passwords)', async () => {
    const { vault } = setup();
    await vault.save({ domain: 'a.com', username: 'user1', password: 'password123' });
    await vault.save({ domain: 'b.com', username: 'user2', password: 'password456' });
    const result = await vault.list();
    expect(result.credentials.length).toBe(2);
    for (const cred of result.credentials) {
      expect((cred as unknown as Record<string, unknown>).encryptedPassword).toBeUndefined();
    }
  });

  it('returns empty list when vault is empty', async () => {
    const { vault } = setup();
    const result = await vault.list();
    expect(result.credentials).toEqual([]);
  });
});

// ===========================================================================
// delete
// ===========================================================================
describe('credential-vault / delete', () => {
  it('deletes a credential by id', async () => {
    const { vault } = setup();
    const saved = await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    const result = await vault.delete(saved.credential!.id);
    expect(result.success).toBe(true);
    const list = await vault.list();
    expect(list.credentials.length).toBe(0);
  });

  it('returns error for unknown id', async () => {
    const { vault } = setup();
    const result = await vault.delete('unknown');
    expect(result.success).toBe(false);
  });
});

// ===========================================================================
// generateAndStore
// ===========================================================================
describe('credential-vault / generateAndStore', () => {
  it('generates and stores a password (NEVER returns it)', async () => {
    const { vault } = setup();
    const result = await vault.generateAndStore({ domain: 'example.com', username: 'user' });
    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.credential).toBeDefined();
    // MUST NOT contain password
    expect((result as unknown as Record<string, unknown>).password).toBeUndefined();
    expect((result.credential as unknown as Record<string, unknown>)?.encryptedPassword).toBeUndefined();
  });

  it('overwrites existing credential (created=false)', async () => {
    const { vault } = setup();
    await vault.generateAndStore({ domain: 'example.com', username: 'user' });
    const result = await vault.generateAndStore({ domain: 'example.com', username: 'user' });
    expect(result.success).toBe(true);
    expect(result.created).toBe(false);
  });

  it('the generated password is encrypted (not stored as plaintext)', async () => {
    const { vault, storage, encryption } = setup();
    await vault.generateAndStore({ domain: 'example.com', username: 'user' });
    expect(encryption.encryptCalls.length).toBe(1);
    // The stored record's encryptedPassword should be the encrypted value
    // (NOT the plaintext that was passed to encryptString).
    const records = await storage.read();
    const plaintext = encryption.encryptCalls[0]!;
    expect(records[0]!.encryptedPassword).not.toBe(plaintext);
    // Verify the encrypted value is different from the plaintext.
    expect(records[0]!.encryptedPassword.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// fill
// ===========================================================================
describe('credential-vault / fill', () => {
  it('fills the login form and returns safe result (no password)', async () => {
    const { vault, fakeWc } = setup();
    await vault.save({ domain: 'example.com', username: 'user@example.com', password: 'supersecret123' });
    const result = await vault.fill({ tabId: 'tab_1', domain: 'example.com' });
    expect(result.success).toBe(true);
    expect(result.usernameFilled).toBe(true);
    expect(result.passwordFilled).toBe(true);
    expect(result.matchedDomain).toBe('example.com');
    // MUST NOT contain the password
    expect((result as unknown as Record<string, unknown>).password).toBeUndefined();
    // The fill script was executed on the WebContents
    expect(fakeWc.filledScripts.length).toBe(1);
  });

  it('fills for a subdomain of the stored domain', async () => {
    const { vault } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    const result = await vault.fill({ tabId: 'tab_1', domain: 'login.example.com' });
    expect(result.success).toBe(true);
    expect(result.matchedDomain).toBe('example.com');
  });

  it('fails for mismatched domain (evil-example.com)', async () => {
    const { vault } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    const result = await vault.fill({ tabId: 'tab_1', domain: 'evil-example.com' });
    expect(result.success).toBe(false);
  });

  it('fails when no credential exists for the domain', async () => {
    const { vault } = setup();
    const result = await vault.fill({ tabId: 'tab_1', domain: 'example.com' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('no_credential_for_domain');
  });

  it('fails when tab is unknown', async () => {
    const { vault } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    const result = await vault.fill({ tabId: 'unknown_tab', domain: 'example.com' });
    expect(result.success).toBe(false);
  });

  it('fails when tab WebContents is destroyed', async () => {
    const { vault, fakeWc } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    fakeWc.destroyed = true;
    const result = await vault.fill({ tabId: 'tab_1', domain: 'example.com' });
    expect(result.success).toBe(false);
  });

  it('decrypts the password only during fill (not during list/has)', async () => {
    const { vault, encryption } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    // list should NOT decrypt
    await vault.list();
    expect(encryption.decryptCalls.length).toBe(0);
    // has should NOT decrypt
    await vault.has({ domain: 'example.com' });
    expect(encryption.decryptCalls.length).toBe(0);
    // fill SHOULD decrypt
    await vault.fill({ tabId: 'tab_1', domain: 'example.com' });
    expect(encryption.decryptCalls.length).toBe(1);
  });
});

// ===========================================================================
// Encryption boundary
// ===========================================================================
describe('credential-vault / encryption boundary', () => {
  it('plaintext does not appear in the persisted representation', async () => {
    const { vault, storage } = setup();
    const PLAINTEXT = 'unique_plaintext_marker_12345';
    await vault.save({ domain: 'example.com', username: 'user', password: PLAINTEXT });
    // The storage buffer should NOT contain the plaintext.
    expect(storage.containsPlaintext(PLAINTEXT)).toBe(false);
  });

  it('handles unavailable encryption gracefully', async () => {
    const encryption = new FakeUnavailableEncryptionAdapter();
    const storage = new MemoryVaultStorageAdapter();
    const vault = new CredentialVault({
      encryption,
      storage,
      resolveWebContents: () => null,
      now: makeClock(1_000_000),
    });
    const result = await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('SAFE_STORAGE_UNAVAILABLE');
  });
});

// ===========================================================================
// Registration foundation flow
// ===========================================================================
describe('credential-vault / registration foundation', () => {
  it('generateAndStore → fill → safe completion', async () => {
    const { vault } = setup();
    // Step 1: Generate and store
    const genResult = await vault.generateAndStore({ domain: 'example.com', username: 'newuser@example.com' });
    expect(genResult.success).toBe(true);
    expect(genResult.created).toBe(true);
    // The generated password is NOT returned.
    expect((genResult as unknown as Record<string, unknown>).password).toBeUndefined();

    // Step 2: Fill
    const fillResult = await vault.fill({ tabId: 'tab_1', domain: 'example.com' });
    expect(fillResult.success).toBe(true);
    expect(fillResult.usernameFilled).toBe(true);
    expect(fillResult.passwordFilled).toBe(true);
    // The password is NOT in the fill result.
    expect((fillResult as unknown as Record<string, unknown>).password).toBeUndefined();
  });
});

// ===========================================================================
// Agent security — vault tools return no passwords
// ===========================================================================
describe('credential-vault / agent security', () => {
  it('VaultPort.has returns no password', async () => {
    const { vault } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    const result = await vault.has({ domain: 'example.com' });
    const json = JSON.stringify(result);
    expect(json).not.toContain('password123');
    expect(json).not.toContain('encryptedPassword');
  });

  it('VaultPort.fill returns no password', async () => {
    const { vault } = setup();
    await vault.save({ domain: 'example.com', username: 'user', password: 'password123' });
    const result = await vault.fill({ tabId: 'tab_1', domain: 'example.com' });
    const json = JSON.stringify(result);
    expect(json).not.toContain('password123');
  });

  it('VaultPort.generateAndStore returns no password', async () => {
    const { vault, encryption } = setup();
    const result = await vault.generateAndStore({ domain: 'example.com', username: 'user' });
    const json = JSON.stringify(result);
    // The generated password should not be in the result.
    expect(json).not.toContain(encryption.encryptCalls[0] ?? 'no_encrypt_call');
  });

  it('VaultPort does NOT have getPassword or decrypt methods', () => {
    const { vault } = setup();
    expect((vault as unknown as unknown as Record<string, unknown>).getPassword).toBeUndefined();
    expect((vault as unknown as unknown as Record<string, unknown>).decrypt).toBeUndefined();
    expect((vault as unknown as unknown as Record<string, unknown>).listWithPasswords).toBeUndefined();
  });
});
