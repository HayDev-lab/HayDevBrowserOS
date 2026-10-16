/**
 * Vault IPC contract test (PROMPT 03) — the renderer adapter and the Rust
 * command signatures MUST agree on command names and argument keys.
 *
 * This is a STATIC contract test: it parses the Rust source (no cargo run)
 * so a rename on either side fails here immediately instead of surfacing
 * as a broken UI action. The live behavior is covered by the native E2E
 * vault cycle (tests/e2e/p03-vault.e2e.test.mjs).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const commandsRs = readFileSync(
  new URL('../src-tauri/src/commands.rs', import.meta.url),
  'utf8',
);
const tauriTs = readFileSync(
  new URL('../src/renderer/src/platform/tauri.ts', import.meta.url),
  'utf8',
);

interface Contract {
  cmd: string;
  /** Argument key the adapter sends (null = no payload). */
  argKey: string | null;
  /** Rust parameter type for that key. */
  rustType?: string;
}

const CONTRACTS: Contract[] = [
  { cmd: 'vault_save', argKey: 'input', rustType: 'VaultSaveRequest' },
  { cmd: 'vault_has', argKey: 'input', rustType: 'VaultHasRequest' },
  { cmd: 'vault_list', argKey: null },
  { cmd: 'vault_generate_and_store', argKey: 'input', rustType: 'VaultGenerateRequest' },
  { cmd: 'vault_fill', argKey: 'input', rustType: 'VaultFillRequest' },
  { cmd: 'vault_delete', argKey: 'id' },
  { cmd: 'vault_prompt_current', argKey: null },
  { cmd: 'vault_prompt_resolve', argKey: 'answer' },
];

describe('vault IPC contract (renderer adapter ↔ Rust commands)', () => {
  it('every adapter call has a matching Rust command + argument key', () => {
    for (const c of CONTRACTS) {
      const adapter = tauriTs.includes(`invoke('${c.cmd}'`)
        ? new RegExp(`invoke\\('${c.cmd}',\\s*\\{\\s*${c.argKey ?? '[a-z]+'}`)
        : null;
      if (c.argKey !== null) {
        expect(
          adapter,
          `adapter must call ${c.cmd} with { ${c.argKey} }`,
        ).not.toBeNull();
      } else {
        expect(tauriTs.includes(`invoke('${c.cmd}'`), `${c.cmd} must be called`).toBe(true);
      }

      const rust = c.argKey !== null
        ? new RegExp(
            `pub\\s+(async\\s+)?fn\\s+${c.cmd}\\s*\\([^)]*${c.argKey}\\s*:\\s*${c.rustType ?? '[A-Za-z]+'}`,
            's',
          )
        : new RegExp(`pub\\s+(async\\s+)?fn\\s+${c.cmd}\\s*\\(`);
      expect(rust.test(commandsRs), `commands.rs must declare ${c.cmd}(${c.argKey}: ${c.rustType})`).toBe(true);
    }
  });

  it('vault_fill takes a TYPED request carrying id (+ optional tabId), not free-form Value', () => {
    expect(commandsRs).toMatch(/struct VaultFillRequest[\s\S]*?pub\s+id:\s+String[\s\S]*?pub\s+tab_id:\s+Option<String>/);
    // The old substring-domain check must be gone.
    expect(commandsRs.includes('page_url.contains(&record.domain)')).toBe(false);
  });

  it('fill authorization uses domain_policy with a re-check before the secret write', () => {
    expect(commandsRs).toMatch(/host_matches_record/);
    expect(commandsRs).toMatch(/VAULT_DOMAIN_AMBIGUOUS/);
    // Both values are written in one document-bound operation, before events.
    expect(commandsRs).toContain("VAULT_DOCUMENT_CHANGED");
    expect(commandsRs).toContain("el.ownerDocument !== document");
    expect(commandsRs).toContain("location.origin === a.document.origin");
    expect(commandsRs.indexOf("setter.call(el, value)")).toBeLessThan(commandsRs.indexOf("for (const [el] of fields)"));
  });

  it('generate_password uses the OS CSPRNG (no time-seeded xorshift)', () => {
    expect(commandsRs).toMatch(/getrandom::getrandom/);
    expect(commandsRs.includes('seed ^= seed << 13')).toBe(false);
  });

  it('Rust vault command registry exposes the same command names', () => {
    const libRs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
    for (const c of CONTRACTS) {
      expect(libRs).toContain(`commands::${c.cmd}`);
    }
  });
});
