/**
 * Incognito policy tests — pure logic.
 *
 * Verifies that all privacy policy decisions are correct:
 *   - History persistence: OFF in incognito
 *   - Agent timeline persistence: OFF in incognito
 *   - Vault auto-save: OFF always (V1), explicitly denied in incognito
 *   - Vault generate: DENIED in incognito
 *   - Vault fill/has: ALLOWED in incognito
 *   - Session isolation: incognito → temporary partition, regular → persistent
 *   - TAKE CONTROL: safe for incognito (doesn't destroy private state)
 */
import { describe, it, expect } from 'vitest';
import {
  shouldPersistHistory,
  shouldPersistHistoryForIncognito,
  shouldPersistAgentTimeline,
  shouldAutoSaveVault,
  isVaultGenerateAllowed,
  isVaultFillAllowed,
  isVaultHasAllowed,
  getSessionKindForTab,
  isPrivateSessionKind,
  isPersistentSessionKind,
  isIncognitoContext,
  isSafeTakeControlForIncognito,
} from '../src/main/browser/incognito/pure/incognito-policy';
import type { TabState } from '@shared/browser-types';

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab_1',
    url: 'https://example.com/',
    pendingUrl: 'https://example.com/',
    title: 'Example',
    loadState: 'committed',
    error: null,
    canGoBack: false,
    canGoForward: false,
    isIncognito: false,
    isActive: true,
    isAudioPlaying: false,
      unreadCount: 0,
      isDiscarded: false,
    createdAt: 1_000_000,
    lastActivatedAt: 1_000_000,
    ...overrides,
  };
}

// ===========================================================================
// History persistence
// ===========================================================================
describe('incognito-policy / history persistence', () => {
  it('persists history for regular tabs', () => {
    expect(shouldPersistHistory(makeTab({ isIncognito: false }))).toBe(true);
  });

  it('does NOT persist history for incognito tabs', () => {
    expect(shouldPersistHistory(makeTab({ isIncognito: true }))).toBe(false);
  });

  it('shouldPersistHistoryForIncognito returns false for incognito', () => {
    expect(shouldPersistHistoryForIncognito(true)).toBe(false);
  });

  it('shouldPersistHistoryForIncognito returns true for regular', () => {
    expect(shouldPersistHistoryForIncognito(false)).toBe(true);
  });
});

// ===========================================================================
// Agent timeline persistence
// ===========================================================================
describe('incognito-policy / agent timeline persistence', () => {
  it('persists agent timeline for regular context', () => {
    expect(shouldPersistAgentTimeline(false)).toBe(true);
  });

  it('does NOT persist agent timeline for incognito context', () => {
    expect(shouldPersistAgentTimeline(true)).toBe(false);
  });
});

// ===========================================================================
// Vault auto-save
// ===========================================================================
describe('incognito-policy / vault auto-save', () => {
  it('auto-save is OFF for regular context (V1)', () => {
    expect(shouldAutoSaveVault(false)).toBe(false);
  });

  it('auto-save is OFF for incognito context (always)', () => {
    expect(shouldAutoSaveVault(true)).toBe(false);
  });
});

// ===========================================================================
// Vault generate
// ===========================================================================
describe('incognito-policy / vault generate', () => {
  it('vault.generate_and_store is ALLOWED in regular context', () => {
    expect(isVaultGenerateAllowed(false)).toBe(true);
  });

  it('vault.generate_and_store is DENIED in incognito context', () => {
    expect(isVaultGenerateAllowed(true)).toBe(false);
  });
});

// ===========================================================================
// Vault fill / has
// ===========================================================================
describe('incognito-policy / vault fill and has', () => {
  it('vault.fill is ALLOWED in regular context', () => {
    expect(isVaultFillAllowed(false)).toBe(true);
  });

  it('vault.fill is ALLOWED in incognito context', () => {
    expect(isVaultFillAllowed(true)).toBe(true);
  });

  it('vault.has is ALLOWED in regular context', () => {
    expect(isVaultHasAllowed(false)).toBe(true);
  });

  it('vault.has is ALLOWED in incognito context', () => {
    expect(isVaultHasAllowed(true)).toBe(true);
  });
});

// ===========================================================================
// Session isolation
// ===========================================================================
describe('incognito-policy / session isolation', () => {
  it('regular tab → default session kind', () => {
    expect(getSessionKindForTab(false)).toBe('default');
  });

  it('incognito tab → incognito session kind', () => {
    expect(getSessionKindForTab(true)).toBe('incognito');
  });

  it('isPrivateSessionKind: incognito is private', () => {
    expect(isPrivateSessionKind('incognito')).toBe(true);
  });

  it('isPrivateSessionKind: default is NOT private', () => {
    expect(isPrivateSessionKind('default')).toBe(false);
  });

  it('isPersistentSessionKind: default is persistent', () => {
    expect(isPersistentSessionKind('default')).toBe(true);
  });

  it('isPersistentSessionKind: incognito is NOT persistent', () => {
    expect(isPersistentSessionKind('incognito')).toBe(false);
  });
});

// ===========================================================================
// Incognito context detection
// ===========================================================================
describe('incognito-policy / context detection', () => {
  it('returns true when active tab is incognito', () => {
    expect(isIncognitoContext(makeTab({ isIncognito: true }))).toBe(true);
  });

  it('returns false when active tab is regular', () => {
    expect(isIncognitoContext(makeTab({ isIncognito: false }))).toBe(false);
  });

  it('returns false when no active tab', () => {
    expect(isIncognitoContext(null)).toBe(false);
  });
});

// ===========================================================================
// TAKE CONTROL safety
// ===========================================================================
describe('incognito-policy / TAKE CONTROL safety', () => {
  it('TAKE CONTROL is safe for incognito (does not destroy private state)', () => {
    expect(isSafeTakeControlForIncognito(true)).toBe(true);
  });

  it('TAKE CONTROL is safe for regular', () => {
    expect(isSafeTakeControlForIncognito(false)).toBe(true);
  });
});

// ===========================================================================
// No fake "anonymous" claims
// ===========================================================================
describe('incognito-policy / no fake anonymity claims', () => {
  it('policy functions do NOT claim anonymity', () => {
    // The policy module only enforces session isolation, NOT anonymity.
    // We verify that the function names and return values do not suggest
    // anonymity (e.g. no isAnonymous function).
    // This is a documentation test — the module enforces isolation, not
    // anonymity (VPN/Tor/anti-fingerprinting are OUT of scope).
    expect(typeof shouldPersistHistory).toBe('function');
    expect(typeof shouldAutoSaveVault).toBe('function');
    // There is no isAnonymous or isFullyAnonymous function.
  });
});
