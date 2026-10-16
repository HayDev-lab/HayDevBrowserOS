/**
 * Credential Vault — typed contracts.
 *
 * Shared across pure + runtime + IPC + renderer.
 *
 * SECURITY RULES (NON-NEGOTIABLE):
 *   - `CredentialRecord.encryptedPassword` is the ONLY persistent representation.
 *   - Plaintext passwords NEVER appear in:
 *     - VaultResult types (returned to renderer/IPC)
 *     - AgentToolResult observation (returned to model)
 *     - Timeline entries
 *     - Logs
 *     - Reports
 *   - The ONLY place plaintext exists is inside `CredentialVault.fill()` —
 *     a main-process-only method that decrypts → fills → discards the
 *     reference immediately.
 *   - `vault.getPassword` / `vault.decrypt` / `vault.listWithPasswords`
 *     do NOT exist in any API surface (IPC, agent tools, or pure logic).
 *
 * Pure data — no Electron imports.
 */

// ---------------------------------------------------------------------------
// Persistent record (stored on disk)
// ---------------------------------------------------------------------------

/**
 * The on-disk representation. `encryptedPassword` is a base64-encoded
 * safeStorage-encrypted string. It CANNOT be decrypted without the OS-level
 * key (DPAPI on Windows, Keychain on macOS, libsecret on Linux).
 */
export interface CredentialRecord {
  id: string;
  domain: string;
  username: string;
  /** Base64-encoded safeStorage-encrypted password. NEVER plaintext. */
  encryptedPassword: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Safe metadata (returned to renderer / IPC / agent)
// ---------------------------------------------------------------------------

/**
 * The safe view of a credential record. This is what the renderer, IPC
 * responses, and agent tool results contain. NEVER includes the password
 * (encrypted or plaintext).
 */
export interface CredentialMetadata {
  id: string;
  domain: string;
  username: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Vault operation inputs
// ---------------------------------------------------------------------------

export interface VaultSaveInput {
  domain: string;
  username: string;
  /** Plaintext password — accepted ONLY from the user UI (renderer), never from the agent. */
  password: string;
}

export interface VaultGenerateInput {
  domain: string;
  username: string;
  /** Optional password length. Default: 20. Hard cap: 128. */
  length?: number;
}

export interface VaultFillInput {
  /** The concrete vault record to fill from (PROMPT 03). */
  id: string;
  /** Target tab; omitted = the active tab. */
  tabId?: string;
}

export interface VaultHasInput {
  domain: string;
}

export interface VaultDeleteInput {
  id: string;
}

// ---------------------------------------------------------------------------
// Login capture (save-password prompt)
// ---------------------------------------------------------------------------

/**
 * A pending "save password?" prompt. Delivered to the renderer chrome via a
 * push event. SECURITY: the captured plaintext password NEVER appears here —
 * it lives only in the main-process capture service until resolved.
 */
export interface PasswordSavePrompt {
  id: string;
  tabId: string;
  /** Canonicalized hostname (e.g. "example.com"). */
  domain: string;
  username: string;
  createdAt: number;
}

/** Push payload for the `vault:prompt:update` channel. */
export type PasswordPromptUpdate =
  | { kind: 'set'; prompt: PasswordSavePrompt }
  | { kind: 'clear' };

/** Raw payload sent by the tab preload when a login form is submitted. */
export interface CapturedLoginSubmit {
  url: string;
  username: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Vault operation results (ALL safe — no plaintext)
// ---------------------------------------------------------------------------

export interface VaultSaveResult {
  success: boolean;
  /** The saved credential metadata (without password). */
  credential?: CredentialMetadata;
  error?: string;
}

export interface VaultGenerateResult {
  success: boolean;
  /** The stored credential metadata (without password). */
  credential?: CredentialMetadata;
  error?: string;
  /**
   * True if a NEW credential was created; false if an existing one was
   * overwritten. (The generated password is NEVER returned.)
   */
  created: boolean;
}

export interface VaultFillResult {
  success: boolean;
  /** True if the username field was found and filled. */
  usernameFilled: boolean;
  /** True if the password field was found and filled. */
  passwordFilled: boolean;
  /** The domain that was matched (for the user to verify). */
  matchedDomain?: string;
  error?: string;
}

export interface VaultHasResult {
  has: boolean;
  /** The matching credential metadata (without password), if found. */
  credential?: CredentialMetadata;
}

export interface VaultListResult {
  credentials: CredentialMetadata[];
}

export interface VaultDeleteResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Agent-facing VaultPort — consumed by the agent loop
// ---------------------------------------------------------------------------

/**
 * The agent loop calls this interface for `vault.*` tools. It is a MINIMAL
 * subset of CredentialVault's API — it does NOT include `save` (which
 * requires plaintext) or `list` (which is UI-only).
 *
 * The agent gets:
 *   - vault.has(domain) → {has, credential?} (metadata only)
 *   - vault.fill(tabId, domain) → {success, usernameFilled, passwordFilled}
 *   - vault.generate_and_store(domain, username) → {success, credential?, created}
 *
 * The agent does NOT get:
 *   - vault.getPassword() — does not exist
 *   - vault.decrypt() — does not exist
 *   - vault.save(domain, username, password) — UI-only (requires plaintext)
 *   - vault.list() — UI-only (returns metadata, but the agent doesn't need it)
 */
export interface VaultPort {
  has(input: VaultHasInput): Promise<VaultHasResult>;
  fill(input: VaultFillInput): Promise<VaultFillResult>;
  generateAndStore(input: VaultGenerateInput): Promise<VaultGenerateResult>;
}

// ---------------------------------------------------------------------------
// Encryption adapter interface (production = safeStorage, tests = fake)
// ---------------------------------------------------------------------------

export interface EncryptionAdapter {
  /** Encrypt a plaintext string. Returns base64-encoded ciphertext. */
  encryptString(plaintext: string): string;
  /** Decrypt a base64-encoded ciphertext. Returns plaintext. */
  decryptString(encrypted: string): string;
  /** True if encryption is available (OS keychain / DPAPI accessible). */
  isEncryptionAvailable(): boolean;
}

// ---------------------------------------------------------------------------
// Storage adapter interface (production = file-backed, tests = in-memory)
// ---------------------------------------------------------------------------

export interface VaultStorageAdapter {
  /** Read all records. Returns empty array if no data. */
  read(): Promise<CredentialRecord[]>;
  /** Write all records (atomic). */
  write(records: CredentialRecord[]): Promise<void>;
  /** True if storage file exists. */
  exists(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Vault bounds
// ---------------------------------------------------------------------------

export const VAULT_BOUNDS = {
  /** Default generated password length. */
  DEFAULT_PASSWORD_LENGTH: 20,
  /** Hard cap on password length. */
  MAX_PASSWORD_LENGTH: 128,
  /** Minimum password length. */
  MIN_PASSWORD_LENGTH: 8,
  /** Max username length. */
  MAX_USERNAME_LENGTH: 256,
  /** Max domain length. */
  MAX_DOMAIN_LENGTH: 253,
  /** Max metadata keys. */
  MAX_METADATA_KEYS: 10,
  /** Max metadata value length. */
  MAX_METADATA_VALUE_LENGTH: 256,
} as const;

// ---------------------------------------------------------------------------
// Agent tool name extensions (PROMPT 6)
// ---------------------------------------------------------------------------
export const VAULT_TOOL_NAMES = [
  'vault.has',
  'vault.fill',
  'vault.generate_and_store',
] as const;

export type VaultToolName = (typeof VAULT_TOOL_NAMES)[number];
