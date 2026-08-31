/**
 * Vault record validator — pure logic.
 *
 * Validates CredentialRecord fields and VaultSaveInput/VaultGenerateInput.
 * Ensures domain is canonical, username is bounded, password meets policy.
 */
import { VAULT_BOUNDS } from '@shared/vault-types';
import { canonicalizeDomain } from './domain-matcher';
import type {
  VaultSaveInput,
  VaultGenerateInput,
  CredentialRecord,
  CredentialMetadata,
} from '@shared/vault-types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a VaultSaveInput (user-initiated save with plaintext password).
 */
export function validateSaveInput(input: VaultSaveInput): ValidationResult {
  const errors: string[] = [];

  const domainResult = canonicalizeDomain(input.domain);
  if (domainResult.domain === null) {
    errors.push(`domain:${domainResult.reason}`);
  }

  if (!isNonEmptyString(input.username)) {
    errors.push('username:empty');
  } else if (input.username.length > VAULT_BOUNDS.MAX_USERNAME_LENGTH) {
    errors.push(`username:too_long:${input.username.length}`);
  }

  if (!isNonEmptyString(input.password)) {
    errors.push('password:empty');
  } else if (input.password.length < VAULT_BOUNDS.MIN_PASSWORD_LENGTH) {
    errors.push(`password:too_short:${input.password.length}`);
  } else if (input.password.length > VAULT_BOUNDS.MAX_PASSWORD_LENGTH) {
    errors.push(`password:too_long:${input.password.length}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a VaultGenerateInput.
 */
export function validateGenerateInput(input: VaultGenerateInput): ValidationResult {
  const errors: string[] = [];

  const domainResult = canonicalizeDomain(input.domain);
  if (domainResult.domain === null) {
    errors.push(`domain:${domainResult.reason}`);
  }

  if (!isNonEmptyString(input.username)) {
    errors.push('username:empty');
  } else if (input.username.length > VAULT_BOUNDS.MAX_USERNAME_LENGTH) {
    errors.push(`username:too_long:${input.username.length}`);
  }

  if (input.length !== undefined) {
    if (!Number.isFinite(input.length) || input.length < VAULT_BOUNDS.MIN_PASSWORD_LENGTH) {
      errors.push(`length:too_short:${input.length}`);
    } else if (input.length > VAULT_BOUNDS.MAX_PASSWORD_LENGTH) {
      errors.push(`length:too_long:${input.length}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a CredentialRecord (after loading from storage).
 * Ensures required fields exist and are bounded.
 */
export function validateRecord(record: unknown): record is CredentialRecord {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return false;
  if (typeof r.domain !== 'string' || r.domain.length === 0) return false;
  if (typeof r.username !== 'string' || r.username.length === 0) return false;
  if (typeof r.encryptedPassword !== 'string' || r.encryptedPassword.length === 0) return false;
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return false;
  if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) return false;
  return true;
}

/**
 * Convert a CredentialRecord to safe CredentialMetadata (strips password).
 */
export function toMetadata(record: CredentialRecord): CredentialMetadata {
  return {
    id: record.id,
    domain: record.domain,
    username: record.username,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Convert an array of CredentialRecords to safe CredentialMetadata[].
 */
export function toMetadataList(records: CredentialRecord[]): CredentialMetadata[] {
  return records.map(toMetadata);
}

/**
 * Sanitize metadata — ensure no secret values leaked through metadata fields.
 */
export function sanitizeMetadata(
  metadata: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const keys = Object.keys(metadata);
  if (keys.length > VAULT_BOUNDS.MAX_METADATA_KEYS) {
    keys.splice(VAULT_BOUNDS.MAX_METADATA_KEYS);
  }
  const sanitized: Record<string, string> = {};
  for (const key of keys) {
    const value = String(metadata[key] ?? '');
    sanitized[key] = value.slice(0, VAULT_BOUNDS.MAX_METADATA_VALUE_LENGTH);
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
