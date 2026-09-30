import { describe, it, expect } from 'vitest';
import {
  validateSaveInput,
  validateGenerateInput,
  validateRecord,
  toMetadata,
  toMetadataList,
  sanitizeMetadata,
} from '../src/main/browser/vault/pure/vault-record-validator';
import type { CredentialRecord } from '@shared/vault-types';

function makeRecord(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    id: 'cred_1',
    domain: 'example.com',
    username: 'user@example.com',
    encryptedPassword: 'base64encrypted',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

// ===========================================================================
// validateSaveInput
// ===========================================================================
describe('vault-record-validator / validateSaveInput', () => {
  it('accepts valid input', () => {
    const r = validateSaveInput({
      domain: 'example.com',
      username: 'user@example.com',
      password: 'securepassword123',
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects empty domain', () => {
    const r = validateSaveInput({ domain: '', username: 'user', password: 'password123' });
    expect(r.valid).toBe(false);
  });

  it('rejects invalid domain', () => {
    const r = validateSaveInput({ domain: 'localhost', username: 'user', password: 'password123' });
    expect(r.valid).toBe(false);
  });

  it('rejects empty username', () => {
    const r = validateSaveInput({ domain: 'example.com', username: '', password: 'password123' });
    expect(r.valid).toBe(false);
  });

  it('rejects short password (< 8 chars)', () => {
    const r = validateSaveInput({ domain: 'example.com', username: 'user', password: 'short' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('too_short'))).toBe(true);
  });

  it('rejects empty password', () => {
    const r = validateSaveInput({ domain: 'example.com', username: 'user', password: '' });
    expect(r.valid).toBe(false);
  });
});

// ===========================================================================
// validateGenerateInput
// ===========================================================================
describe('vault-record-validator / validateGenerateInput', () => {
  it('accepts valid input without length', () => {
    const r = validateGenerateInput({ domain: 'example.com', username: 'user' });
    expect(r.valid).toBe(true);
  });

  it('accepts valid input with length', () => {
    const r = validateGenerateInput({ domain: 'example.com', username: 'user', length: 32 });
    expect(r.valid).toBe(true);
  });

  it('rejects length below minimum', () => {
    const r = validateGenerateInput({ domain: 'example.com', username: 'user', length: 4 });
    expect(r.valid).toBe(false);
  });

  it('rejects length above maximum', () => {
    const r = validateGenerateInput({ domain: 'example.com', username: 'user', length: 200 });
    expect(r.valid).toBe(false);
  });

  it('rejects NaN length', () => {
    const r = validateGenerateInput({ domain: 'example.com', username: 'user', length: NaN });
    expect(r.valid).toBe(false);
  });
});

// ===========================================================================
// validateRecord
// ===========================================================================
describe('vault-record-validator / validateRecord', () => {
  it('accepts a valid record', () => {
    expect(validateRecord(makeRecord())).toBe(true);
  });

  it('rejects null/undefined', () => {
    expect(validateRecord(null)).toBe(false);
    expect(validateRecord(undefined)).toBe(false);
  });

  it('rejects record with missing id', () => {
    expect(validateRecord({ ...makeRecord(), id: '' })).toBe(false);
  });

  it('rejects record with missing encryptedPassword', () => {
    expect(validateRecord({ ...makeRecord(), encryptedPassword: '' })).toBe(false);
  });

  it('rejects record with non-number createdAt', () => {
    expect(validateRecord({ ...makeRecord(), createdAt: 'not-a-number' as unknown as number })).toBe(false);
  });
});

// ===========================================================================
// toMetadata / toMetadataList
// ===========================================================================
describe('vault-record-validator / toMetadata', () => {
  it('strips encryptedPassword from the record', () => {
    const meta = toMetadata(makeRecord({ encryptedPassword: 'supersecret' }));
    expect(meta.id).toBe('cred_1');
    expect(meta.domain).toBe('example.com');
    expect(meta.username).toBe('user@example.com');
    // encryptedPassword must NOT be a field on CredentialMetadata.
    expect((meta as unknown as Record<string, unknown>).encryptedPassword).toBeUndefined();
  });

  it('toMetadataList strips passwords from all records', () => {
    const records = [
      makeRecord({ id: '1', encryptedPassword: 'pw1' }),
      makeRecord({ id: '2', encryptedPassword: 'pw2' }),
    ];
    const list = toMetadataList(records);
    expect(list.length).toBe(2);
    for (const meta of list) {
      expect((meta as unknown as Record<string, unknown>).encryptedPassword).toBeUndefined();
    }
  });
});

// ===========================================================================
// sanitizeMetadata
// ===========================================================================
describe('vault-record-validator / sanitizeMetadata', () => {
  it('limits metadata keys to MAX_METADATA_KEYS', () => {
    const large: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      large[`key${i}`] = 'val';
    }
    const sanitized = sanitizeMetadata(large)!;
    expect(Object.keys(sanitized).length).toBe(10);
  });

  it('truncates metadata values to MAX_METADATA_VALUE_LENGTH', () => {
    const sanitized = sanitizeMetadata({ key: 'x'.repeat(300) })!;
    expect(sanitized.key!.length).toBe(256);
  });

  it('returns undefined for empty/undefined input', () => {
    expect(sanitizeMetadata(undefined)).toBeUndefined();
  });
});
