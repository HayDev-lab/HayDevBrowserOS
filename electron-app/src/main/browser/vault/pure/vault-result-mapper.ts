/**
 * Vault result mapper — pure logic.
 *
 * Maps internal CredentialRecord + operation results to safe VaultResult
 * types that can be sent to the renderer / IPC / agent.
 *
 * SECURITY: This module is the LAST line of defense before data leaves the
 * vault. It MUST strip:
 *   - encryptedPassword (always)
 *   - plaintext (should never reach here, but defense-in-depth)
 *   - Any field whose name contains "password" (case-insensitive) that
 *     is NOT explicitly part of the safe result shape.
 *
 * It also builds safe timeline summaries for vault.* agent tools.
 */
import type {
  CredentialRecord,
  CredentialMetadata,
  VaultSaveResult,
  VaultGenerateResult,
  VaultFillResult,
  VaultHasResult,
  VaultListResult,
  VaultDeleteResult,
} from '@shared/vault-types';
import { toMetadata, toMetadataList } from './vault-record-validator';

const REDACTED = '<redacted>';

// ---------------------------------------------------------------------------
// Safe result builders
// ---------------------------------------------------------------------------

export function buildSaveResult(
  record: CredentialRecord | null,
  error?: string
): VaultSaveResult {
  if (error || !record) {
    return { success: false, error: error ?? 'unknown_error' };
  }
  return {
    success: true,
    credential: toMetadata(record),
  };
}

export function buildGenerateResult(
  record: CredentialRecord | null,
  created: boolean,
  error?: string
): VaultGenerateResult {
  if (error || !record) {
    return { success: false, created: false, error: error ?? 'unknown_error' };
  }
  return {
    success: true,
    credential: toMetadata(record),
    created,
  };
}

export function buildFillResult(
  usernameFilled: boolean,
  passwordFilled: boolean,
  matchedDomain: string | null,
  error?: string
): VaultFillResult {
  if (error) {
    return {
      success: false,
      usernameFilled: false,
      passwordFilled: false,
      error,
    };
  }
  return {
    success: true,
    usernameFilled,
    passwordFilled,
    matchedDomain: matchedDomain ?? undefined,
  };
}

export function buildHasResult(
  record: CredentialRecord | null,
  pageDomain: string
): VaultHasResult {
  if (!record) return { has: false };
  return {
    has: true,
    credential: toMetadata(record),
  };
}

export function buildListResult(records: CredentialRecord[]): VaultListResult {
  return {
    credentials: toMetadataList(records),
  };
}

export function buildDeleteResult(
  deleted: boolean,
  error?: string
): VaultDeleteResult {
  if (error || !deleted) {
    return { success: false, error: error ?? 'not_found' };
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Timeline-safe summaries for vault.* agent tools
// ---------------------------------------------------------------------------

/**
 * Build a safe summary string for a vault tool call.
 * NEVER includes the password, encryptedPassword, or plaintext.
 */
export function buildVaultTimelineSummary(
  tool: string,
  args: Record<string, unknown>,
  result: { success: boolean; usernameFilled?: boolean; passwordFilled?: boolean; created?: boolean } | null
): string {
  switch (tool) {
    case 'vault.has': {
      const domain = String(args.domain ?? '');
      const has = result?.success ? 'found' : 'not_found';
      return `vault.has → ${truncate(domain, 80)} (${has})`;
    }
    case 'vault.fill': {
      const domain = String(args.domain ?? '');
      if (result?.success) {
        const u = result.usernameFilled ? '✓' : '✗';
        const p = result.passwordFilled ? '✓' : '✗';
        return `vault.fill → ${truncate(domain, 80)} (user:${u},pass:${p},${REDACTED})`;
      }
      return `vault.fill → ${truncate(domain, 80)} (failed,${REDACTED})`;
    }
    case 'vault.generate_and_store': {
      const domain = String(args.domain ?? '');
      const created = result?.created ? 'created' : 'overwritten';
      return `vault.generate → ${truncate(domain, 80)} (${created}, ${REDACTED})`;
    }
    default:
      return `vault.${tool}`;
  }
}

// ---------------------------------------------------------------------------
// Defense-in-depth: verify a result object has no plaintext leakage
// ---------------------------------------------------------------------------

/**
 * Check if a vault result object contains any suspicious secret-like patterns.
 * Returns true if the result is safe (no secrets detected).
 */
export function isResultSafe(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true;
  const json = JSON.stringify(result);
  // The result must NEVER contain a field named "password" with a non-empty
  // non-redacted value.
  if (/"password"\s*:\s*"[^"<]/.test(json)) return false;
  if (/"encryptedPassword"\s*:\s*"[^"<]/.test(json)) return false;
  if (/"plaintextPassword"\s*:\s*"/.test(json)) return false;
  if (/"decryptedPassword"\s*:\s*"/.test(json)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return '…';
  return s.slice(0, max - 1) + '…';
}
