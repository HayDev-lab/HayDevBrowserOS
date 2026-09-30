/**
 * AgentOverlay — in-page status plaque shown while the agent runs.
 *
 * Renders a small fixed-position "agent working" indicator (animated dot +
 * status label) in the page the agent is currently acting on, mirroring the
 * chrome timeline. Removed when the run settles.
 *
 * SECURITY (same rules as VaultFillAdapter):
 *   - The injected script is a STATIC template. The only interpolation is
 *     the status label, which comes exclusively from the fixed vocabulary
 *     in pure/overlay-labels.ts (code-owned, never model-controlled).
 *   - No remote resources; inline styles only; the dot animates via the
 *     Web Animations API (CSP-safe, no injected <style>).
 *
 * DEFERRED_RUNTIME: imports Electron types only; not unit-tested directly.
 */
import type { WebContents } from 'electron';

export interface AgentOverlayDeps {
  resolveWebContents: (tabId: string) => WebContents | null;
}

const ELEMENT_ID = '__pab_agent_overlay__';

export class AgentOverlay {
  constructor(private deps: AgentOverlayDeps) {}

  /** Create (or refresh) the plaque on the tab the agent is acting on. */
  update(tabId: string, label: string): void {
    const wc = this.deps.resolveWebContents(tabId);
    if (!wc || wc.isDestroyed()) return;
    const labelJson = JSON.stringify(String(label).slice(0, 60));
    void wc
      .executeJavaScript(
        `(() => {
  const ID = ${JSON.stringify(ELEMENT_ID)};
  const LABEL = ${labelJson};
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ID;
    el.setAttribute('style', [
      'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'gap:8px',
      'padding:7px 14px 7px 11px',
      'background:rgba(4,6,12,0.88)',
      'border:1px solid rgba(0,240,212,0.45)', 'border-radius:8px',
      'box-shadow:0 0 18px rgba(0,240,212,0.25), 0 6px 18px rgba(0,0,0,0.5)',
      'color:#eef5ff', 'font:600 12px/1.2 ui-sans-serif,system-ui,Segoe UI,sans-serif',
      'letter-spacing:0.05em', 'pointer-events:none',
      'backdrop-filter:blur(10px)'
    ].join(';'));
    const dot = document.createElement('span');
    dot.setAttribute('style', [
      'width:8px', 'height:8px', 'border-radius:50%',
      'background:#00f0d4', 'box-shadow:0 0 8px rgba(0,240,212,0.8)',
      'display:inline-block', 'flex-shrink:0'
    ].join(';'));
    try {
      dot.animate(
        [{ opacity: 0.35, transform: 'scale(0.75)' }, { opacity: 1, transform: 'scale(1.15)' }, { opacity: 0.35, transform: 'scale(0.75)' }],
        { duration: 1200, iterations: Infinity }
      );
    } catch (e) {}
    const text = document.createElement('span');
    text.setAttribute('data-role', 'label');
    el.appendChild(dot);
    el.appendChild(text);
    document.documentElement.appendChild(el);
  }
  const text = el.querySelector('[data-role="label"]');
  if (text) text.textContent = LABEL + '\\u2026';
  return true;
})()`,
        true
      )
      .catch(() => {
        // Page may forbid script injection or be mid-teardown — the plaque
        // is cosmetic; never fail the agent run over it.
      });
  }

  /** Remove the plaque (idempotent; a navigated-away page is a no-op). */
  hide(): void {
    // No tab list here — hide is best-effort on the last known webContents,
    // tracked by the controller through the same resolveWebContents call.
    for (const wc of this.lastTargets()) {
      if (wc && !wc.isDestroyed()) {
        void wc
          .executeJavaScript(
            `(() => { const el = document.getElementById(${JSON.stringify(ELEMENT_ID)}); if (el) el.remove(); return true; })()`,
            true
          )
          .catch(() => {});
      }
    }
    this.targets = [];
  }

  private targets: WebContents[] = [];

  private lastTargets(): WebContents[] {
    return this.targets.filter((wc) => !wc.isDestroyed());
  }

  /** Track the webContents so hide() can clean up after navigation. */
  track(tabId: string): void {
    const wc = this.deps.resolveWebContents(tabId);
    if (wc && !wc.isDestroyed() && !this.targets.includes(wc)) {
      this.targets.push(wc);
      if (this.targets.length > 8) this.targets.shift();
    }
  }
}
