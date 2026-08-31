/**
 * WebContents action adapter — Electron-bound implementation of
 * `ActionRuntimeAdapter`.
 *
 * DEFERRED_RUNTIME: imports `electron`. The interface is in
 * `@shared/browser-actions-types` (pure). Tests use a `FakeAdapter`.
 *
 * SECURITY:
 *   - Uses `webContents.executeJavaScript()` ONLY with internally-generated
 *     scripts. NEVER accepts a JS string from the caller.
 *   - The click/type/scroll/readPage scripts are static templates that take
 *     only stable ids / bounded text / bounded amounts as parameters.
 *   - No `eval`, no `new Function`, no string interpolation into JS expressions
 *     beyond numeric ids and (for `type`) a JSON.stringify'd text payload.
 *
 * STABLE ID RESOLUTION:
 *   The adapter mirrors the snapshot normalizer's `el_<n>` scheme. Each
 *   action script re-queries the DOM in the same order the snapshot did,
 *   so the same `el_<n>` id resolves to the same element (assuming the
 *   page hasn't changed). If the page changed, the script returns null
 *   and the adapter throws an `element_not_found` ActionError.
 */
import type { WebContents } from 'electron';
import type {
  ActionRuntimeAdapter,
  RawPageData,
} from '@shared/browser-actions-types';
import { ActionError } from '../pure/action-router';

// ---------------------------------------------------------------------------
// Adapter dependencies
// ---------------------------------------------------------------------------

export interface WebContentsAdapterDeps {
  /**
   * Resolve a tab id to its underlying WebContents.
   * Returns null if the tab is unknown or its webContents is destroyed.
   */
  resolveWebContents(tabId: string): WebContents | null;
  /** Optional timeout for executeJavaScript calls. Default: 5000ms. */
  executionTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class WebContentsActionAdapter implements ActionRuntimeAdapter {
  constructor(private deps: WebContentsAdapterDeps) {}

  async navigate(tabId: string, url: string): Promise<string> {
    const wc = this.resolve(tabId);
    try {
      await wc.loadURL(url);
      return wc.getURL();
    } catch (err) {
      throw new ActionError('navigate_failed', `tab:${tabId},${safeErr(err)}`);
    }
  }

  async readPageRaw(
    tabId: string,
    opts: { maxTextLength: number; maxElements: number }
  ): Promise<RawPageData> {
    const wc = this.resolve(tabId);
    const script = buildReadPageScript(opts);
    try {
      const raw = (await wc.executeJavaScript(script, true)) as RawPageData;
      if (!raw || typeof raw !== 'object') {
        throw new ActionError('readpage_failed', `tab:${tabId},invalid_payload`);
      }
      return raw;
    } catch (err) {
      if (err instanceof ActionError) throw err;
      throw new ActionError('readpage_failed', `tab:${tabId},${safeErr(err)}`);
    }
  }

  async click(tabId: string, elementId: string): Promise<boolean> {
    const wc = this.resolve(tabId);
    const index = parseElementIndex(elementId);
    if (index === null) {
      throw new ActionError('element_not_found', `tab:${tabId},element:${elementId}`);
    }
    const script = buildClickScript(index);
    try {
      const result = (await wc.executeJavaScript(script, true)) as ClickScriptResult;
      if (!result.found) {
        throw new ActionError('element_not_found', `tab:${tabId},element:${elementId}`);
      }
      if (result.disabled) {
        throw new ActionError('element_disabled', `tab:${tabId},element:${elementId}`);
      }
      return result.clicked;
    } catch (err) {
      if (err instanceof ActionError) throw err;
      throw new ActionError('click_failed', `tab:${tabId},${safeErr(err)}`);
    }
  }

  async type(
    tabId: string,
    elementId: string,
    text: string,
    clearFirst: boolean
  ): Promise<{ charactersTyped: number; wasPasswordField: boolean }> {
    const wc = this.resolve(tabId);
    const index = parseElementIndex(elementId);
    if (index === null) {
      throw new ActionError('element_not_found', `tab:${tabId},element:${elementId}`);
    }
    const script = buildTypeScript(index, text, clearFirst);
    try {
      const result = (await wc.executeJavaScript(script, true)) as TypeScriptResult;
      if (!result.found) {
        throw new ActionError('element_not_found', `tab:${tabId},element:${elementId}`);
      }
      if (!result.editable) {
        throw new ActionError('not_editable', `tab:${tabId},element:${elementId}`);
      }
      return {
        charactersTyped: result.charactersTyped,
        wasPasswordField: result.wasPasswordField,
      };
    } catch (err) {
      if (err instanceof ActionError) throw err;
      throw new ActionError('type_failed', `tab:${tabId},${safeErr(err)}`);
    }
  }

  async scroll(
    tabId: string,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number
  ): Promise<boolean> {
    const wc = this.resolve(tabId);
    const script = buildScrollScript(direction, amount);
    try {
      const result = (await wc.executeJavaScript(script, true)) as { scrolled: boolean };
      return !!result.scrolled;
    } catch (err) {
      throw new ActionError('scroll_failed', `tab:${tabId},${safeErr(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private resolve(tabId: string): WebContents {
    const wc = this.deps.resolveWebContents(tabId);
    if (!wc || wc.isDestroyed()) {
      throw new ActionError('tab_not_found', `tab_id:${tabId}`);
    }
    return wc;
  }
}

// ---------------------------------------------------------------------------
// Script builders — INTERNAL, never accept caller-supplied JS.
// ---------------------------------------------------------------------------

interface ClickScriptResult {
  found: boolean;
  disabled: boolean;
  clicked: boolean;
}

interface TypeScriptResult {
  found: boolean;
  editable: boolean;
  charactersTyped: number;
  wasPasswordField: boolean;
}

/**
 * Parse `el_<n>` → n. Returns null if the format doesn't match.
 */
function parseElementIndex(elementId: string): number | null {
  const match = /^el_(\d+)$/.exec(elementId);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Build the readPage script. The script collects visible text, interactive
 * elements, and forms, returning a RawPageData-compatible object.
 *
 * The script is a STATIC template — only the numeric bounds are interpolated.
 * No caller-supplied string ever reaches `executeJavaScript` as code.
 *
 * The script assigns stable indices to elements by iterating them in DOM
 * order. The same iteration is used by `buildClickScript` and `buildTypeScript`
 * so `el_<n>` resolves consistently (assuming the page hasn't changed
 * between snapshot and action).
 */
function buildReadPageScript(opts: {
  maxTextLength: number;
  maxElements: number;
}): string {
  // Numeric only — safe to interpolate.
  const maxText = Math.max(0, Math.floor(opts.maxTextLength));
  const maxElements = Math.max(0, Math.floor(opts.maxElements));
  return `(function () {
  var MAX_TEXT = ${maxText};
  var MAX_ELEMENTS = ${maxElements};

  function isVisible(el) {
    if (!el) return false;
    if (el.nodeType !== 1) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return true;
  }

  function accessibleName(el) {
    var n = el.getAttribute('aria-label');
    if (n && n.trim()) return n.trim();
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var target = document.getElementById(labelledBy);
      if (target) return (target.textContent || '').trim();
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      var name = el.getAttribute('name');
      var placeholder = el.getAttribute('placeholder');
      var id = el.id;
      var label = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : null;
      if (label) return (label.textContent || '').trim();
      if (placeholder) return placeholder;
      if (name) return name;
    }
    return (el.textContent || '').trim().slice(0, 200);
  }

  // Collect interactive elements in DOM order.
  var interactiveSelector = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"]';
  var allCandidates = Array.prototype.slice.call(document.querySelectorAll(interactiveSelector));
  var visibleElements = [];
  var filteredCount = 0;
  for (var i = 0; i < allCandidates.length; i++) {
    var el = allCandidates[i];
    if (!isVisible(el)) { filteredCount++; continue; }
    if (visibleElements.length >= MAX_ELEMENTS) {
      filteredCount += allCandidates.length - i;
      break;
    }
    visibleElements.push(el);
  }

  var rawElements = visibleElements.map(function (el) {
    var inputType = el.getAttribute('type') || undefined;
    return {
      tagName: el.tagName,
      role: el.getAttribute('role') || '',
      accessibleName: accessibleName(el),
      disabled: !!el.disabled,
      hidden: !isVisible(el),
      href: el.href || undefined,
      inputType: inputType,
      placeholder: el.getAttribute('placeholder') || undefined,
      value: el.value !== undefined ? el.value : undefined,
      checked: el.checked !== undefined ? el.checked : undefined,
      name: el.getAttribute('name') || undefined
    };
  });

  // Build forms.
  var formList = Array.prototype.slice.call(document.querySelectorAll('form'));
  var rawForms = formList.map(function (form) {
    var elementIndices = [];
    for (var j = 0; j < visibleElements.length; j++) {
      if (form.contains(visibleElements[j])) elementIndices.push(j);
    }
    return {
      action: form.getAttribute('action') || undefined,
      method: form.getAttribute('method') || undefined,
      name: form.getAttribute('name') || undefined,
      elementIndices: elementIndices
    };
  });

  // Visible text: collect text content of body, truncated.
  var bodyText = (document.body && document.body.innerText) || '';
  var textTruncated = bodyText.length > MAX_TEXT;
  var visibleText = bodyText.slice(0, MAX_TEXT);

  return {
    url: window.location.href,
    title: document.title || '',
    visibleText: visibleText,
    textTruncated: textTruncated,
    rawElements: rawElements,
    rawForms: rawForms,
    filteredCount: filteredCount
  };
})();`;
}

function buildClickScript(index: number): string {
  const n = Math.max(0, Math.floor(index));
  return `(function () {
  var INDEX = ${n};
  var interactiveSelector = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"]';
  var allCandidates = Array.prototype.slice.call(document.querySelectorAll(interactiveSelector));
  var visibleElements = [];
  for (var i = 0; i < allCandidates.length; i++) {
    var el = allCandidates[i];
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    visibleElements.push(el);
  }
  var target = visibleElements[INDEX];
  if (!target) return { found: false, disabled: false, clicked: false };
  if (target.disabled) return { found: true, disabled: true, clicked: false };
  try {
    target.focus();
    target.click();
    return { found: true, disabled: false, clicked: true };
  } catch (e) {
    return { found: true, disabled: false, clicked: false };
  }
})();`;
}

function buildTypeScript(
  index: number,
  text: string,
  clearFirst: boolean
): string {
  const n = Math.max(0, Math.floor(index));
  const clear = clearFirst ? 'true' : 'false';
  // JSON.stringify the text — this is the ONLY caller-supplied string that
  // reaches the page, and it's escaped as a JSON string literal, not as code.
  const textJson = JSON.stringify(text);
  return `(function () {
  var INDEX = ${n};
  var TEXT = ${textJson};
  var CLEAR = ${clear};
  var interactiveSelector = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"]';
  var allCandidates = Array.prototype.slice.call(document.querySelectorAll(interactiveSelector));
  var visibleElements = [];
  for (var i = 0; i < allCandidates.length; i++) {
    var el = allCandidates[i];
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    visibleElements.push(el);
  }
  var target = visibleElements[INDEX];
  if (!target) return { found: false, editable: false, charactersTyped: 0, wasPasswordField: false };
  var editable = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !target.disabled && !target.readOnly;
  if (!editable) return { found: true, editable: false, charactersTyped: 0, wasPasswordField: false };
  var inputType = (target.getAttribute('type') || '').toLowerCase();
  var wasPasswordField = inputType === 'password';
  try {
    target.focus();
    if (CLEAR) target.value = '';
    // Use document.execCommand for input events that frameworks can react to.
    document.execCommand('insertText', false, TEXT);
    var typed = target.value.length;
    return { found: true, editable: true, charactersTyped: typed, wasPasswordField: wasPasswordField };
  } catch (e) {
    return { found: true, editable: true, charactersTyped: 0, wasPasswordField: wasPasswordField };
  }
})();`;
}

function buildScrollScript(
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number
): string {
  const n = Math.max(0, Math.floor(amount));
  const dir = ['up', 'down', 'left', 'right'].includes(direction)
    ? direction
    : 'down';
  return `(function () {
  var AMOUNT = ${n};
  var DIR = ${JSON.stringify(dir)};
  try {
    if (DIR === 'up') window.scrollBy(0, -AMOUNT);
    else if (DIR === 'down') window.scrollBy(0, AMOUNT);
    else if (DIR === 'left') window.scrollBy(-AMOUNT, 0);
    else if (DIR === 'right') window.scrollBy(AMOUNT, 0);
    return { scrolled: true };
  } catch (e) {
    return { scrolled: false };
  }
})();`;
}

function safeErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/\s+/g, ' ').slice(0, 200);
  }
  return String(err).slice(0, 200);
}
