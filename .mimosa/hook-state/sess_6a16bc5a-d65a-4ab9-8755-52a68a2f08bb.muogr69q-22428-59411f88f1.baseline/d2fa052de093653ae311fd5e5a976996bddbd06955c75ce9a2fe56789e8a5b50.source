/**
 * Password generator — pure logic (no electron, but uses node:crypto).
 *
 * Generates cryptographically-secure passwords using `crypto.randomBytes`.
 * NEVER uses `Math.random` or `Date.now` for password entropy.
 *
 * The generated password is returned to the caller (CredentialVault) which
 * encrypts it immediately via safeStorage and discards the plaintext reference.
 * The password is NEVER returned to the renderer, IPC, or agent.
 */
import { randomBytes } from 'node:crypto';
import { VAULT_BOUNDS } from '@shared/vault-types';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

const ALL_CHARS = LOWERCASE + UPPERCASE + DIGITS + SYMBOLS;

export interface GeneratedPassword {
  /** The plaintext password. Caller must encrypt + discard immediately. */
  password: string;
  /** The length of the generated password. */
  length: number;
}

/**
 * Generate a cryptographically-secure password.
 *
 * Requirements:
 *   - Uses `crypto.randomBytes` for entropy (NOT Math.random).
 *   - At least 1 lowercase, 1 uppercase, 1 digit, 1 symbol.
 *   - Length between MIN_PASSWORD_LENGTH (8) and MAX_PASSWORD_LENGTH (128).
 *   - Default length: 20.
 *
 * SECURITY: The returned password is plaintext. The caller (CredentialVault)
 * MUST encrypt it immediately and discard the reference. It must NEVER be
 * returned to the renderer, IPC, agent, or logs.
 */
export function generatePassword(
  length: number = VAULT_BOUNDS.DEFAULT_PASSWORD_LENGTH
): GeneratedPassword {
  const clampedLength = clampLength(length);

  // Generate the password using rejection sampling to avoid modulo bias.
  const chars: string[] = [];

  // Ensure at least one of each required character class.
  chars.push(pickChar(LOWERCASE));
  chars.push(pickChar(UPPERCASE));
  chars.push(pickChar(DIGITS));
  chars.push(pickChar(SYMBOLS));

  // Fill the rest with random characters from all classes.
  for (let i = chars.length; i < clampedLength; i++) {
    chars.push(pickChar(ALL_CHARS));
  }

  // Shuffle the characters (Fisher-Yates with crypto randomness).
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    const temp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = temp;
  }

  return {
    password: chars.join(''),
    length: clampedLength,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clampLength(length: number): number {
  if (!Number.isFinite(length) || length < VAULT_BOUNDS.MIN_PASSWORD_LENGTH) {
    return VAULT_BOUNDS.MIN_PASSWORD_LENGTH;
  }
  return Math.min(length, VAULT_BOUNDS.MAX_PASSWORD_LENGTH);
}

/**
 * Pick a character from the given charset using rejection sampling.
 * This avoids modulo bias that would occur with `randomByte % charset.length`.
 */
function pickChar(charset: string): string {
  const max = charset.length;
  // Rejection range: we need a value in [0, max). randomBytes gives us
  // values in [0, 256). We reject values >= floor(256 / max) * max to
  // avoid bias.
  const limit = Math.floor(256 / max) * max;
  let byte: number;
  do {
    byte = randomBytes(1)[0]!;
  } while (byte >= limit);
  return charset[byte % max]!;
}

/**
 * Generate a random integer in [0, max) using crypto.randomBytes.
 * Uses rejection sampling for unbiased results.
 */
function secureRandomInt(max: number): number {
  if (max <= 0) return 0;
  if (max === 1) return 0;
  // Use enough bytes to cover the range.
  const byteCount = Math.ceil(Math.log2(max) / 8);
  const limit = Math.floor(Math.pow(256, byteCount) / max) * max;
  let value: number;
  do {
    const buf = randomBytes(byteCount);
    value = 0;
    for (let i = 0; i < byteCount; i++) {
      value = value * 256 + buf[i]!;
    }
  } while (value >= limit);
  return value % max;
}
