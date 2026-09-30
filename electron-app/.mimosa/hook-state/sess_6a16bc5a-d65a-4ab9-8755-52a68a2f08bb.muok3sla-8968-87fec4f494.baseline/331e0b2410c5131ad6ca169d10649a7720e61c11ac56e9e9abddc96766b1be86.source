/**
 * Selection action prompt tests.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSelectionPrompt,
  MAX_SELECTION_LENGTH,
} from '../src/main/browser/agent/pure/selection-actions';

describe('buildSelectionPrompt', () => {
  it('embeds the selection into a bounded quoted block', () => {
    const p = buildSelectionPrompt('explain', 'quantum tunneling');
    expect(p).toContain('Explain');
    expect(p).toContain('quantum tunneling');
    expect(p).toContain('"""');
  });

  it('distinguishes the three actions', () => {
    expect(buildSelectionPrompt('translate', 'x')).toContain('Russian');
    expect(buildSelectionPrompt('summarize', 'x')).toContain('bullet');
    expect(buildSelectionPrompt('explain', 'x')).toContain('simple terms');
  });

  it('caps oversized selections', () => {
    const huge = 'a'.repeat(MAX_SELECTION_LENGTH + 5000);
    const p = buildSelectionPrompt('explain', huge);
    expect(p.length).toBeLessThan(MAX_SELECTION_LENGTH + 500);
  });

  it('handles empty/whitespace input defensively', () => {
    const p = buildSelectionPrompt('summarize', '   ');
    expect(p).toContain('Summarize');
  });
});
