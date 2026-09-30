/**
 * Overlay label mapping tests — the fixed vocabulary shown on the in-page
 * agent plaque. The template only interpolates these code-owned strings.
 */
import { describe, it, expect } from 'vitest';
import { getOverlayLabelForTool } from '../src/main/browser/agent/pure/overlay-labels';

describe('getOverlayLabelForTool', () => {
  it('maps the full tool vocabulary to short human labels', () => {
    expect(getOverlayLabelForTool('browser.navigate')).toBe('Navigating');
    expect(getOverlayLabelForTool('browser.read')).toBe('Reading page');
    expect(getOverlayLabelForTool('page.click')).toBe('Clicking');
    expect(getOverlayLabelForTool('page.type')).toBe('Typing');
    expect(getOverlayLabelForTool('page.scroll')).toBe('Scrolling');
    expect(getOverlayLabelForTool('tabs.open')).toBe('Creating tab');
    expect(getOverlayLabelForTool('vault.fill')).toBe('Filling credentials');
  });

  it('falls back to a generic label for unknown tools', () => {
    expect(getOverlayLabelForTool('something.new')).toBe('Working');
    expect(getOverlayLabelForTool('')).toBe('Working');
  });

  it('never returns an empty label', () => {
    for (const tool of [
      'browser.navigate', 'browser.read', 'page.click', 'page.type',
      'page.scroll', 'page.screenshot', 'tabs.list', 'tabs.open',
      'tabs.activate', 'tabs.close', 'agent.stop', 'vault.has',
      'vault.fill', 'vault.generate_and_store', 'not_a_tool',
    ]) {
      expect(getOverlayLabelForTool(tool).length).toBeGreaterThan(0);
    }
  });
});
