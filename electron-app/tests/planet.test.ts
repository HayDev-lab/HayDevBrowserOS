/**
 * Rotating digital planet — template wiring tests (Matrix NTP spec §7).
 */
import { describe, it, expect } from 'vitest';
import {
  PLANET_CANVAS,
  PLANET_ROTATION_PERIOD_MS,
  buildPlanetScript,
} from '../src/main/browser/pure/planet';
import { buildNewTabHtml } from '../src/main/browser/pure/newtab-page';

describe('planet snippet', () => {
  it('canvas + CSS sphere are pointer-transparent and layered', () => {
    expect(PLANET_CANVAS).toContain('id="planet-shell"');
    expect(PLANET_CANVAS).toContain('id="planet-canvas"');
    expect(PLANET_CANVAS).toContain('aria-hidden="true"');
  });

  it('rotation period is inside the spec window (90–180 s per revolution)', () => {
    expect(PLANET_ROTATION_PERIOD_MS).toBeGreaterThanOrEqual(90_000);
    expect(PLANET_ROTATION_PERIOD_MS).toBeLessThanOrEqual(180_000);
    expect(buildPlanetScript()).toContain(String(PLANET_ROTATION_PERIOD_MS));
  });

  it('rotates continuously, delta-time based, frame-rate independent', () => {
    const s = buildPlanetScript();
    expect(s).toContain('requestAnimationFrame');
    expect(s).toContain('dt / PERIOD_MS');       // angle advances by elapsed time
    expect(s).toContain('angle +=');             // no resets back to a fixed pose
  });

  it('caps DPR and downgrades on low-core machines', () => {
    const s = buildPlanetScript();
    expect(s).toContain('Math.min(window.devicePixelRatio || 1, MAX_DPR)');
    expect(s).toContain('MAX_DPR = 1.5');
    expect(s).toContain('hardwareConcurrency');
  });

  it('pauses when hidden and honors prefers-reduced-motion', () => {
    const s = buildPlanetScript();
    expect(s).toContain('visibilitychange');
    expect(s).toContain('document.hidden');
    expect(s).toContain('prefers-reduced-motion');
    expect(s).toContain('renderStatic');
  });

  it('falls back gracefully when WebGL is unavailable', () => {
    const s = buildPlanetScript();
    expect(s).toContain("getContext('webgl'");
    expect(s).toContain('experimental-webgl');
    expect(s).toContain('fallback2d');           // Canvas2D static wireframe
    expect(s).toContain('webglcontextlost');
  });

  it('releases RAF + WebGL resources on pagehide (no leaks)', () => {
    const s = buildPlanetScript();
    expect(s).toContain('cancelAnimationFrame');
    expect(s).toContain('WEBGL_lose_context');
    expect(s).toContain('pagehide');
    expect(s).toContain('dispose');
  });

  it('wired into the New Tab page behind the hero UI', () => {
    const html = buildNewTabHtml([]);
    expect(html).toContain('id="planet-canvas"');
    expect(html).toContain('__pabPlanet');       // script embedded + idempotent
  });
});
