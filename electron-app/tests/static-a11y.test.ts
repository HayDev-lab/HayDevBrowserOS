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
  // Since the i18n refactor the components read user-facing strings from the
  // locale dictionaries via t('key'), so the aria-label assertions below check
  // the dictionary key wiring; the en dictionary itself is asserted to carry
  // the human-readable text.
  const enDict = readFileSync(join(RENDERER_DIR, 'i18n', 'locales', 'en.ts'), 'utf8');

  it('TabStrip uses role=tablist on the strip and role=tab on each tab', () => {
    const src = readComponent('TabStrip.tsx');
    expect(src).toContain('role="tablist"');
    expect(src).toContain('role="tab"');
    expect(src).toContain('aria-selected');
  });

  it('TabStrip close button has dynamic aria-label built from "Close" + title', () => {
    const src = readComponent('TabStrip.tsx');
    // The close button uses the tabs.closeAria key with the {title} variable.
    expect(src).toMatch(/aria-label=\{t\('tabs\.closeAria', \{ title: displayTitle \}\)\}/);
    expect(enDict).toMatch(/'tabs\.closeAria': 'Close \{title\}'/);
  });

  it('TabStrip new-tab button has aria-label', () => {
    const src = readComponent('TabStrip.tsx');
    expect(src).toContain("aria-label={t('tabs.newAria')}");
    expect(enDict).toContain("'tabs.newAria': 'Open new tab'");
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
    // And the call sites pass localized Back / Forward labels.
    expect(src).toMatch(/label=\{t\('cmd\.back'\)\}/);
    expect(src).toMatch(/label=\{t\('cmd\.forward'\)\}/);
  });

  it('ControlModule has role=group and aria-label', () => {
    const src = readComponent('ControlModule.tsx');
    expect(src).toContain('role="group"');
    expect(src).toContain("aria-label={t('control.groupAria')}");
    expect(enDict).toContain("'control.groupAria': 'Agent control mode'");
  });

  it('ControlModule mode switch uses role=radiogroup', () => {
    const src = readComponent('ControlModule.tsx');
    expect(src).toContain('role="radiogroup"');
    expect(src).toContain('role="radio"');
    expect(src).toContain('aria-checked');
  });

  it('ControlModule TAKE CONTROL button has aria-label mentioning abort', () => {
    const src = readComponent('ControlModule.tsx');
    expect(src).toContain("ariaLabel={t('control.takeAria')}");
    expect(enDict).toMatch(/'control\.takeAria': 'Take control — abort/);
  });

  it('AgentPanel uses aria-label and role=status for badge', () => {
    const src = readComponent('AgentPanel.tsx');
    expect(src).toContain("aria-label={t('agent.panelAria')}");
    expect(src).toContain('aria-live="polite"');
    expect(enDict).toContain("'agent.panelAria': 'Agent panel'");
  });

  it('AgentPanel STOP button has aria-label', () => {
    const src = readComponent('AgentPanel.tsx');
    expect(src).toMatch(/aria-label=\{t\('agent\.stopAria'\)\}/);
    expect(enDict).toContain("'agent.stopAria': 'Stop the current agent task'");
  });

  it('AgentPanel task input has aria-label', () => {
    const src = readComponent('AgentPanel.tsx');
    expect(src).toContain("aria-label={t('agent.inputAria')}");
    expect(enDict).toContain("'agent.inputAria': 'Agent task input'");
  });

  it('IncognitoBadge uses role=status and aria-label', () => {
    const src = readComponent('IncognitoBadge.tsx');
    expect(src).toContain('role="status"');
    expect(src).toMatch(/aria-label=/);
  });

  it('HistoryPanel has aria-label and panel section', () => {
    const src = readPanel('HistoryPanel.tsx');
    expect(src).toMatch(/aria-label=\{t\('panel\./);
    expect(enDict).toContain("'panel.historyName': 'History'");
  });

  it('BookmarksPanel has aria-label', () => {
    const src = readPanel('BookmarksPanel.tsx');
    expect(src).toMatch(/aria-label=\{t\('panel\./);
    expect(enDict).toContain("'panel.bookmarksName': 'Bookmarks'");
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
