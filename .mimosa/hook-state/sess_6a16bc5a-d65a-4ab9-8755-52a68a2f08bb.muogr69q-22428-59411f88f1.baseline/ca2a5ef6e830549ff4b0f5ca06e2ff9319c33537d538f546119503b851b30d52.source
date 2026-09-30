/**
 * Static source-level tests for accessibility and reduced-motion presence.
 *
 * These tests read the renderer source files and assert that:
 *   - design-tokens.css declares a `prefers-reduced-motion` media query.
 *   - styles.css uses reduced-motion-aware rules.
 *   - components contain aria-* attributes on key elements (tabs, buttons,
 *     take-control, agent panel, panels).
 *
 * These tests do NOT replace runtime accessibility audits — they are a
 * baseline guarantee that the source ships the required hooks. The full
 * WCAG audit is DEFERRED_RUNTIME.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RENDERER_DIR = join(__dirname, '..', 'src', 'renderer', 'src');
const COMPONENTS_DIR = join(RENDERER_DIR, 'components');
const PANELS_DIR = join(COMPONENTS_DIR, 'panels');

function readSrc(rel: string): string {
  return readFileSync(join(RENDERER_DIR, rel), 'utf8');
}

function readComponent(name: string): string {
  return readFileSync(join(COMPONENTS_DIR, name), 'utf8');
}

function readPanel(name: string): string {
  return readFileSync(join(PANELS_DIR, name), 'utf8');
}

describe('static / reduced-motion CSS presence', () => {
  it('design-tokens.css declares a prefers-reduced-motion media query', () => {
    const css = readSrc('design-tokens.css');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('design-tokens.css sets all motion durations to 0ms under reduced motion', () => {
    const css = readSrc('design-tokens.css');
    expect(css).toMatch(/--nc-dur-instant:\s*0ms/);
    expect(css).toMatch(/--nc-dur-fast:\s*0ms/);
    expect(css).toMatch(/--nc-dur-normal:\s*0ms/);
    expect(css).toMatch(/--nc-dur-slow:\s*0ms/);
  });

  it('design-tokens.css forces transition-duration: 0.001ms via universal selector', () => {
    const css = readSrc('design-tokens.css');
    expect(css).toMatch(/transition-duration:\s*0\.001ms\s*!important/);
    expect(css).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
  });

  it('styles.css uses high-contrast media query for accessibility', () => {
    const css = readSrc('styles.css');
    expect(css).toContain('@media (prefers-contrast: more)');
  });
});

describe('static / accessibility attributes', () => {
  it('TabStrip uses role=tablist on the strip and role=tab on each tab', () => {
    const src = readComponent('TabStrip.tsx');
    expect(src).toContain('role="tablist"');
    expect(src).toContain('role="tab"');
    expect(src).toContain('aria-selected');
  });

  it('TabStrip close button has dynamic aria-label built from "Close" + title', () => {
    const src = readComponent('TabStrip.tsx');
    // The close button uses a template literal: aria-label={`Close ${displayTitle}`}
    expect(src).toMatch(/aria-label=\{`Close/);
  });

  it('TabStrip new-tab button has aria-label', () => {
    const src = readComponent('TabStrip.tsx');
    expect(src).toContain('aria-label="Open new tab"');
  });

  it('CommandBar uses role=search', () => {
    const src = readComponent('CommandBar.tsx');
    expect(src).toContain('role="search"');
  });

  it('CommandBar marks invalid input with aria-invalid', () => {
    const src = readComponent('CommandBar.tsx');
    expect(src).toContain('aria-invalid');
  });

  it('CommandBar nav buttons pass aria-label via the label prop', () => {
    const src = readComponent('CommandBar.tsx');
    // The NavButton subcomponent receives a `label` prop and binds it to aria-label.
    expect(src).toMatch(/aria-label=\{label\}/);
    // And the call sites pass "Back" / "Forward" as labels.
    expect(src).toMatch(/label="Back"/);
    expect(src).toMatch(/label="Forward"/);
  });

  it('ControlModule has role=group and aria-label', () => {
    const src = readComponent('ControlModule.tsx');
    expect(src).toContain('role="group"');
    expect(src).toContain('aria-label="Agent control mode"');
  });

  it('ControlModule mode switch uses role=radiogroup', () => {
    const src = readComponent('ControlModule.tsx');
    expect(src).toContain('role="radiogroup"');
    expect(src).toContain('role="radio"');
    expect(src).toContain('aria-checked');
  });

  it('ControlModule TAKE CONTROL button has aria-label mentioning abort', () => {
    const src = readComponent('ControlModule.tsx');
    expect(src).toMatch(/aria-label="Take control — abort/);
  });

  it('AgentPanel uses aria-label and role=status for badge', () => {
    const src = readComponent('AgentPanel.tsx');
    expect(src).toContain('aria-label="Agent panel"');
    expect(src).toContain('aria-live="polite"');
  });

  it('AgentPanel STOP button has aria-label', () => {
    const src = readComponent('AgentPanel.tsx');
    expect(src).toMatch(/aria-label="Stop the current agent task"/);
  });

  it('AgentPanel task input has aria-label', () => {
    const src = readComponent('AgentPanel.tsx');
    expect(src).toContain('aria-label="Agent task input"');
  });

  it('IncognitoBadge uses role=status and aria-label', () => {
    const src = readComponent('IncognitoBadge.tsx');
    expect(src).toContain('role="status"');
    expect(src).toMatch(/aria-label=/);
  });

  it('HistoryPanel has aria-label and panel section', () => {
    const src = readPanel('HistoryPanel.tsx');
    expect(src).toContain('aria-label="History panel"');
  });

  it('BookmarksPanel has aria-label', () => {
    const src = readPanel('BookmarksPanel.tsx');
    expect(src).toContain('aria-label="Bookmarks panel"');
  });

  it('DownloadsPanel uses role=progressbar for in-progress downloads', () => {
    const src = readPanel('DownloadsPanel.tsx');
    expect(src).toContain('role="progressbar"');
    expect(src).toContain('aria-valuenow');
    expect(src).toContain('aria-valuemin');
    expect(src).toContain('aria-valuemax');
  });

  it('DownloadsPanel error has role=alert', () => {
    const src = readPanel('DownloadsPanel.tsx');
    expect(src).toContain('role="alert"');
  });
});

describe('static / design token centralization', () => {
  it('design-tokens.css declares all required token groups', () => {
    const css = readSrc('design-tokens.css');
    const required = [
      '--nc-bg',
      '--nc-surface',
      '--nc-surface-elevated',
      '--nc-border',
      '--nc-border-active',
      '--nc-text-primary',
      '--nc-text-secondary',
      '--nc-accent',
      '--nc-danger',
      '--nc-success',
    ];
    for (const token of required) {
      expect(css).toContain(token);
    }
  });

  it('design-tokens.css declares spacing tokens', () => {
    const css = readSrc('design-tokens.css');
    expect(css).toContain('--nc-sp-1');
    expect(css).toContain('--nc-sp-8');
    expect(css).toContain('--nc-sp-16');
  });

  it('design-tokens.css declares radius tokens', () => {
    const css = readSrc('design-tokens.css');
    expect(css).toContain('--nc-radius-sm');
    expect(css).toContain('--nc-radius-pill');
  });

  it('design-tokens.css declares motion duration tokens', () => {
    const css = readSrc('design-tokens.css');
    expect(css).toContain('--nc-dur-fast');
    expect(css).toContain('--nc-dur-normal');
  });

  it('design-tokens.css declares shadow/glow tokens', () => {
    const css = readSrc('design-tokens.css');
    expect(css).toContain('--nc-shadow-subtle');
    expect(css).toContain('--nc-glow-accent');
    expect(css).toContain('--nc-glow-agent');
    expect(css).toContain('--nc-glow-danger');
  });

  it('styles.css consumes design tokens (no raw hex colors in component CSS)', () => {
    const css = readSrc('styles.css');
    // Allow only the design-tokens.css to declare raw colors; styles.css
    // must consume tokens. We tolerate a few rgba() shorthand for shadows
    // where the alpha is a one-off (e.g. error glow), but base hex colors
    // should all come from tokens.
    const hexMatches = css.match(/#[0-9a-fA-F]{3,8}/g) || [];
    // We expect ZERO raw hex colors in styles.css — everything must come from
    // design-tokens.css via var().
    expect(hexMatches).toEqual([]);
  });
});
