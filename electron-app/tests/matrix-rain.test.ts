/**
 * Matrix rain background — template wiring tests.
 */
import { describe, it, expect } from 'vitest';
import {
  MATRIX_RAIN_CANVAS,
  buildMatrixRainScript,
} from '../src/main/browser/pure/matrix-rain';
import { buildNewTabHtml } from '../src/main/browser/pure/newtab-page';
import { buildSearchPageHtml } from '../src/main/browser/pure/search-page';

describe('matrix-rain snippet', () => {
  it('canvas is fixed, behind content, and pointer-transparent', () => {
    expect(MATRIX_RAIN_CANVAS).toContain('position:fixed');
    expect(MATRIX_RAIN_CANVAS).toContain('z-index:0');
    expect(MATRIX_RAIN_CANVAS).toContain('pointer-events:none');
    expect(MATRIX_RAIN_CANVAS).toContain('id="matrix-rain"');
  });

  it('script animates via rAF with an fps cap', () => {
    const s = buildMatrixRainScript();
    expect(s).toContain('requestAnimationFrame');
    expect(s).toContain('33'); // ~30fps cap
  });

  it('guards prefers-reduced-motion with a static frame', () => {
    const s = buildMatrixRainScript();
    expect(s).toContain('prefers-reduced-motion');
  });
});

describe('matrix-rain wiring in pab pages', () => {
  it('newtab includes the canvas and the rain script', () => {
    const html = buildNewTabHtml([]);
    expect(html).toContain('id="matrix-rain"');
    expect(html).toContain('requestAnimationFrame');
  });

  it('search page includes the canvas and the rain script', () => {
    const html = buildSearchPageHtml({
      perplexicaURL: 'http://127.0.0.1:3000',
      modelKey: 'deepseek-v4-pro:0813',
    });
    expect(html).toContain('id="matrix-rain"');
    expect(html).toContain('requestAnimationFrame');
  });
});
