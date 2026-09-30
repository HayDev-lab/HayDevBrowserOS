/**
 * site-user-agent tests — shell-token cleanup for the site-facing UA.
 *
 * The engine version MUST stay honest; only the embedding-shell tokens
 * (PersonalAgenticBrowser, Electron) are removed.
 */
import { describe, it, expect } from 'vitest';
import { buildSiteUserAgent } from '../src/main/browser/pure/site-user-agent';

const ELECTRON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PersonalAgenticBrowser/0.1.0 Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36';

describe('buildSiteUserAgent', () => {
  it('strips the shell tokens and keeps the engine tokens honest', () => {
    expect(buildSiteUserAgent(ELECTRON_UA)).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.78 Safari/537.36'
    );
  });

  it('does not spoof the engine version', () => {
    const out = buildSiteUserAgent(ELECTRON_UA);
    expect(out).toContain('Chrome/152.0.7977.78'); // the REAL bundled Chromium
  });

  it('leaves an already-clean UA untouched', () => {
    const clean =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.78 Safari/537.36';
    expect(buildSiteUserAgent(clean)).toBe(clean);
  });

  it('handles UA variants without the product name token', () => {
    const noProduct =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.1.2.3 Electron/45.0.0 Safari/537.36';
    expect(buildSiteUserAgent(noProduct)).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.1.2.3 Safari/537.36'
    );
  });

  it('passes through empty and invalid input defensively', () => {
    expect(buildSiteUserAgent('')).toBe('');
  });
});
