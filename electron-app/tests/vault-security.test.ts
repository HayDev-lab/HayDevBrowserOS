import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVaultTimelineSummary,
  isResultSafe,
} from '../src/main/browser/vault/pure/vault-result-mapper';
import { TOOL_DEFINITIONS, isKnownTool } from '../src/main/browser/agent/pure/tool-registry';

// ===========================================================================
// Timeline summaries — vault tools NEVER include passwords
// ===========================================================================
describe('vault-result-mapper / timeline summaries', () => {
  it('vault.has summary does not include password', () => {
    const summary = buildVaultTimelineSummary(
      'vault.has',
      { domain: 'example.com' },
      { success: true }
    );
    expect(summary).toContain('vault.has');
    expect(summary).toContain('example.com');
    expect(summary).not.toContain('password');
  });

  it('vault.fill summary includes redacted marker', () => {
    const summary = buildVaultTimelineSummary(
      'vault.fill',
      { domain: 'example.com' },
      { success: true, usernameFilled: true, passwordFilled: true }
    );
    expect(summary).toContain('vault.fill');
    expect(summary).toContain('example.com');
    expect(summary).toContain('<redacted>');
    expect(summary).not.toMatch(/password\s*[:=]/i);
  });

  it('vault.generate_and_store summary includes redacted marker', () => {
    const summary = buildVaultTimelineSummary(
      'vault.generate_and_store',
      { domain: 'example.com' },
      { success: true, created: true }
    );
    expect(summary).toContain('vault.generate');
    expect(summary).toContain('example.com');
    expect(summary).toContain('<redacted>');
    expect(summary).not.toMatch(/password\s*[:=]/i);
  });

  it('vault.fill failed summary does not include password', () => {
    const summary = buildVaultTimelineSummary(
      'vault.fill',
      { domain: 'example.com' },
      null
    );
    expect(summary).not.toContain('password');
  });
});

// ===========================================================================
// isResultSafe — defense-in-depth check
// ===========================================================================
describe('vault-result-mapper / isResultSafe', () => {
  it('returns true for safe results (no password field)', () => {
    expect(isResultSafe({ success: true, username: 'user' })).toBe(true);
    expect(isResultSafe({ has: false })).toBe(true);
    expect(isResultSafe({ credentials: [] })).toBe(true);
  });

  it('returns false for results containing a password field with a value', () => {
    expect(isResultSafe({ password: 'secret' })).toBe(false);
    expect(isResultSafe({ encryptedPassword: 'base64data' })).toBe(false);
    expect(isResultSafe({ plaintextPassword: 'secret' })).toBe(false);
    expect(isResultSafe({ decryptedPassword: 'secret' })).toBe(false);
  });

  it('returns true for results with password field set to redacted', () => {
    // "<redacted>" starts with "<" so the regex `"[^"<]` won't match.
    expect(isResultSafe({ password: '<redacted>' })).toBe(true);
  });
});

// ===========================================================================
// Agent tool security — no vault.getPassword / vault.decrypt in registry
// ===========================================================================
describe('vault-result-mapper / agent tool security', () => {
  it('tool registry does NOT include vault.getPassword', () => {
    expect(isKnownTool('vault.getPassword')).toBe(false);
  });

  it('tool registry does NOT include vault.decrypt', () => {
    expect(isKnownTool('vault.decrypt')).toBe(false);
  });

  it('tool registry does NOT include vault.listWithPasswords', () => {
    expect(isKnownTool('vault.listWithPasswords')).toBe(false);
  });

  it('tool registry includes the 3 safe vault tools', () => {
    expect(isKnownTool('vault.has')).toBe(true);
    expect(isKnownTool('vault.fill')).toBe(true);
    expect(isKnownTool('vault.generate_and_store')).toBe(true);
  });

  it('tool registry now has 15 tools total (11 + 3 vault + memory)', () => {
    expect(TOOL_DEFINITIONS.length).toBe(15);
  });
});

// ===========================================================================
// Static source audit — no plaintext leakage in vault source
// ===========================================================================
// r10 cleanup: the Electron runtime adapters (credential-vault.ts,
// vault-fill-adapter.ts, src/preload/index.ts) were removed with the Electron
// dependency; their no-plaintext-logging audits applied only to those files.
// The Tauri-side credential vault is audited by Rust tests + native P03/P15.
describe('vault-result-mapper / source audit', () => {
  it('VaultPort interface does NOT include getPassword/decrypt as methods', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'shared', 'vault-types.ts'),
      'utf8'
    );
    // Strip comments before checking.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/getPassword\s*\(/);
    expect(codeOnly).not.toMatch(/decrypt\s*\(/);
    expect(codeOnly).not.toMatch(/listWithPasswords/);
  });

  it('ExposedApi does NOT include vault.getPassword', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'shared', 'ipc-types.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/getPassword/);
    expect(src).not.toMatch(/vault.*decrypt/);
  });
});
