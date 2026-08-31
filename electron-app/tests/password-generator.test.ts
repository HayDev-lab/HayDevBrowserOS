import { describe, it, expect } from 'vitest';
import { generatePassword } from '../src/main/browser/vault/pure/password-generator';

describe('password-generator / basic generation', () => {
  it('generates a password of the default length (20)', () => {
    const { password, length } = generatePassword();
    expect(password).toHaveLength(20);
    expect(length).toBe(20);
  });

  it('generates a password of a custom length', () => {
    const { password, length } = generatePassword(32);
    expect(password).toHaveLength(32);
    expect(length).toBe(32);
  });

  it('clamps to MIN_PASSWORD_LENGTH (8) if too short', () => {
    const { password, length } = generatePassword(4);
    expect(length).toBe(8);
    expect(password).toHaveLength(8);
  });

  it('clamps to MAX_PASSWORD_LENGTH (128) if too long', () => {
    const { password, length } = generatePassword(200);
    expect(length).toBe(128);
    expect(password).toHaveLength(128);
  });
});

describe('password-generator / character classes', () => {
  it('includes at least one lowercase letter', () => {
    for (let i = 0; i < 100; i++) {
      const { password } = generatePassword();
      expect(password).toMatch(/[a-z]/);
    }
  });

  it('includes at least one uppercase letter', () => {
    for (let i = 0; i < 100; i++) {
      const { password } = generatePassword();
      expect(password).toMatch(/[A-Z]/);
    }
  });

  it('includes at least one digit', () => {
    for (let i = 0; i < 100; i++) {
      const { password } = generatePassword();
      expect(password).toMatch(/[0-9]/);
    }
  });

  it('includes at least one symbol', () => {
    for (let i = 0; i < 100; i++) {
      const { password } = generatePassword();
      expect(password).toMatch(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/);
    }
  });
});

describe('password-generator / uniqueness', () => {
  it('generates different passwords on successive calls', () => {
    const { password: p1 } = generatePassword();
    const { password: p2 } = generatePassword();
    expect(p1).not.toBe(p2);
  });

  it('generates 1000 unique passwords', () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      passwords.add(generatePassword().password);
    }
    expect(passwords.size).toBe(1000);
  });
});

describe('password-generator / does NOT use Math.random', () => {
  // We can't directly verify this at runtime, but we can check that the
  // source code uses crypto.randomBytes, not Math.random.
  it('the source code uses crypto.randomBytes', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(__dirname, '..', 'src', 'main', 'browser', 'vault', 'pure', 'password-generator.ts'),
      'utf8'
    );
    expect(src).toContain('randomBytes');
    // Verify Math.random is NOT used in actual code (only allowed in comments).
    // Strip comments before checking.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/\bMath\.random\b/);
  });
});
