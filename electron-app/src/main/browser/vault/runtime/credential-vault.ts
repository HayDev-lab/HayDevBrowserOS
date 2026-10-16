/**
 * CredentialVault — trusted main-process orchestrator.
 *
 * Owns:
 *   - EncryptionAdapter (safeStorage in production, fake in tests).
 *   - VaultStorageAdapter (file-backed in production, in-memory in tests).
 *   - Password generator (crypto-secure).
 *   - Fill adapter (WebContents executeJavaScript).
 *
 * PUBLIC API (UI + IPC):
 *   - save(domain, username, password) → VaultSaveResult (no plaintext in result)
 *   - has(domain) → VaultHasResult (metadata only)
 *   - list() → VaultListResult (metadata only)
 *   - generateAndStore(domain, username) → VaultGenerateResult (no password in result)
 *   - fill(tabId, domain) → VaultFillResult (no plaintext in result)
 *   - delete(id) → VaultDeleteResult
 *
 * AGENT API (via VaultPort — subset):
 *   - has(domain)
 *   - fill(tabId, domain)
 *   - generateAndStore(domain, username)
 *
 * SECURITY:
 *   - Plaintext passwords exist ONLY inside `save()` (received from UI) and
 *     `fill()` (decrypted for autofill). Both discard the reference immediately.
 *   - `generateAndStore()` generates a password, encrypts it, and discards
 *     the plaintext. The generated password is NEVER returned.
 *   - `list()` returns metadata only (no encryptedPassword field).
 *   - `has()` returns metadata only.
 *   - `fill()` returns {success, usernameFilled, passwordFilled} — no password.
 */
import type {
  CredentialRecord,
  EncryptionAdapter,
  VaultStorageAdapter,
  VaultSaveInput,
  VaultGenerateInput,
  VaultFillInput,
  VaultHasInput,
  VaultSaveResult,
  VaultGenerateResult,
  VaultFillResult,
  VaultHasResult,
  VaultListResult,
  VaultDeleteResult,
  VaultPort,
} from '@shared/vault-types';
import { canonicalizeDomain, matchDomain, findMatchingDomain } from '../pure/domain-matcher';
import { generatePassword } from '../pure/password-generator';
import {
  validateSaveInput,
  validateGenerateInput,
  validateRecord,
  toMetadata,
  toMetadataList,
} from '../pure/vault-record-validator';
import {
  buildSaveResult,
  buildGenerateResult,
  buildFillResult,
  buildHasResult,
  buildListResult,
  buildDeleteResult,
} from '../pure/vault-result-mapper';
import { VaultFillAdapter } from './vault-fill-adapter';
import type { WebContents } from 'electron';

let _vaultIdCounter = 0;
function generateRecordId(): string {
  _vaultIdCounter += 1;
  return `cred_${Date.now().toString(36)}_${_vaultIdCounter.toString(36)}`;
}

export interface CredentialVaultDeps {
  encryption: EncryptionAdapter;
  storage: VaultStorageAdapter;
  resolveWebContents: (tabId: string) => WebContents | null;
  /** Override Date.now for tests. */
  now?: () => number;
}

export class CredentialVault implements VaultPort {
  private readonly fillAdapter: VaultFillAdapter;
  private readonly now: () => number;

  constructor(private deps: CredentialVaultDeps) {
    this.fillAdapter = new VaultFillAdapter({
      resolveWebContents: deps.resolveWebContents,
      encryption: deps.encryption,
    });
    this.now = deps.now ?? Date.now;
  }

  // ---------------------------------------------------------------------------
  // UI-facing API
  // ---------------------------------------------------------------------------

  async save(input: VaultSaveInput): Promise<VaultSaveResult> {
    const validation = validateSaveInput(input);
    if (!validation.valid) {
      return buildSaveResult(null, validation.errors.join(';'));
    }

    const domain = canonicalizeDomain(input.domain).domain!;
    const now = this.now();
    const records = await this.deps.storage.read();

    // Find existing record for this domain + username.
    const existingIdx = records.findIndex(
      (r) => r.domain === domain && r.username === input.username
    );

    let encryptedPassword: string;
    try {
      encryptedPassword = this.deps.encryption.encryptString(input.password);
    } catch (err) {
      return buildSaveResult(null, safeErr(err));
    }

    if (existingIdx >= 0) {
      // Update existing record.
      const existing = records[existingIdx]!;
      existing.encryptedPassword = encryptedPassword;
      existing.updatedAt = now;
      await this.deps.storage.write(records);
      return buildSaveResult(existing);
    }

    // Create new record.
    const record: CredentialRecord = {
      id: generateRecordId(),
      domain,
      username: input.username,
      encryptedPassword,
      createdAt: now,
      updatedAt: now,
    };
    records.push(record);
    await this.deps.storage.write(records);
    return buildSaveResult(record);
  }

  async has(input: VaultHasInput): Promise<VaultHasResult> {
    const domainResult = canonicalizeDomain(input.domain);
    if (domainResult.domain === null) {
      return { has: false };
    }

    const records = await this.deps.storage.read();
    // Check if any stored domain matches the queried domain (subdomain match).
    const matchingDomain = findMatchingDomain(
      input.domain,
      records.map((r) => r.domain)
    );

    if (!matchingDomain) {
      return { has: false };
    }

    const record = records.find((r) => r.domain === matchingDomain)!;
    return buildHasResult(record, domainResult.domain);
  }

  async list(): Promise<VaultListResult> {
    const records = await this.deps.storage.read();
    return buildListResult(records);
  }

  async delete(id: string): Promise<VaultDeleteResult> {
    const records = await this.deps.storage.read();
    const idx = records.findIndex((r) => r.id === id);
    if (idx < 0) {
      return buildDeleteResult(false, 'not_found');
    }
    records.splice(idx, 1);
    await this.deps.storage.write(records);
    return buildDeleteResult(true);
  }

  // ---------------------------------------------------------------------------
  // Agent-facing API (VaultPort subset)
  // ---------------------------------------------------------------------------

  async generateAndStore(input: VaultGenerateInput): Promise<VaultGenerateResult> {
    const validation = validateGenerateInput(input);
    if (!validation.valid) {
      return buildGenerateResult(null, false, validation.errors.join(';'));
    }

    const domain = canonicalizeDomain(input.domain).domain!;
    const now = this.now();
    const { password } = generatePassword(input.length);

    // Encrypt immediately — plaintext is discarded after this line.
    let encryptedPassword: string;
    try {
      encryptedPassword = this.deps.encryption.encryptString(password);
    } catch (err) {
      return buildGenerateResult(null, false, safeErr(err));
    }
    // plaintext `password` goes out of scope here.

    const records = await this.deps.storage.read();
    const existingIdx = records.findIndex(
      (r) => r.domain === domain && r.username === input.username
    );

    if (existingIdx >= 0) {
      // Overwrite existing.
      const existing = records[existingIdx]!;
      existing.encryptedPassword = encryptedPassword;
      existing.updatedAt = now;
      await this.deps.storage.write(records);
      return buildGenerateResult(existing, false);
    }

    // Create new record.
    const record: CredentialRecord = {
      id: generateRecordId(),
      domain,
      username: input.username,
      encryptedPassword,
      createdAt: now,
      updatedAt: now,
    };
    records.push(record);
    await this.deps.storage.write(records);
    return buildGenerateResult(record, true);
  }

  async fill(input: VaultFillInput): Promise<VaultFillResult> {
    // PROMPT 03 contract: fill from a CONCRETE record id — never from a
    // display-domain string the caller can guess or spoof.
    const records = await this.deps.storage.read();
    const record = records.find((r) => r.id === input.id);
    if (!record) {
      return buildFillResult(false, false, null, 'no_credential_for_id');
    }
    const tabId = input.tabId;
    if (!tabId) {
      return buildFillResult(false, false, null, 'no_target_tab');
    }

    // The record id is the authorization anchor: whatever called fill must
    // already know the record (vault list / save prompt), and the host-side
    // Tauri runtime additionally re-verifies the tab URL host against the
    // record domain before every field write (domain_policy.rs).
    try {
      const fillResult = await this.fillAdapter.fill(
        tabId,
        record.username,
        record.encryptedPassword
      );
      return buildFillResult(
        fillResult.usernameFilled,
        fillResult.passwordFilled,
        record.domain
      );
    } catch (err) {
      const errCode = err instanceof Error ? err.message.split(':')[0] : 'unknown';
      return buildFillResult(false, false, null, `fill_error:${errCode}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------

  dispose(): void {
    // Nothing to dispose — storage and encryption are stateless.
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/\s+/g, ' ').slice(0, 200);
  }
  return String(err).slice(0, 200);
}
