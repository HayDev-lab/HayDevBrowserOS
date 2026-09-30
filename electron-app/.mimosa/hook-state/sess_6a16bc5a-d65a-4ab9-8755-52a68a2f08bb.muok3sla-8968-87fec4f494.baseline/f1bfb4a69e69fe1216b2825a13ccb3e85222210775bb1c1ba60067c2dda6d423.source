/**
 * Snapshot normalizer — pure logic.
 *
 * Converts raw page data (returned by the runtime adapter's `readPageRaw`)
 * into a normalized `PageSnapshot` with:
 *   - Stable element ids (`el_<index>`, `form_<index>`).
 *   - Password field values redacted.
 *   - File input values redacted.
 *   - Truncation of visible text.
 *   - Filtering of hidden elements (configurable).
 *
 * NO electron import. Fully unit-testable.
 *
 * SECURITY:
 *   - Password fields (`inputType === 'password'`) ALWAYS produce
 *     `valueState: '<redacted>'`. The raw `value` is discarded.
 *   - File inputs (`inputType === 'file'`) produce `valueState: '<file>'`.
 *   - All other values are passed through but bounded by `maxTextLength`
 *     to prevent runaway LLM context.
 */
import type {
  PageSnapshot,
  InteractiveElement,
  FormSnapshot,
  ElementRole,
  RawPageData,
  RawInteractiveElement,
  RawForm,
} from '@shared/browser-actions-types';

const REDACTED_PASSWORD = '<redacted>';
const REDACTED_FILE = '<file>';
const DEFAULT_MAX_TEXT = 10_000;
const DEFAULT_MAX_ELEMENTS = 200;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NormalizeOptions {
  /** Stable snapshot id (caller-assigned, e.g. `snap_<timestamp>_<rand>`). */
  snapshotId: string;
  /** Tab id. */
  tabId: string;
  /** Override the default max text length. */
  maxTextLength?: number;
  /** Override the default max interactive elements. */
  maxElements?: number;
  /** Whether to include hidden elements in the snapshot. Default: false. */
  includeHidden?: boolean;
  /** Override `Date.now()` for tests. */
  now?: () => number;
}

export function normalizeSnapshot(
  raw: RawPageData,
  opts: NormalizeOptions
): PageSnapshot {
  const maxText = clamp(opts.maxTextLength ?? DEFAULT_MAX_TEXT, 0, 50_000);
  const maxElements = clamp(opts.maxElements ?? DEFAULT_MAX_ELEMENTS, 0, 1000);
  const includeHidden = opts.includeHidden ?? false;
  const now = opts.now ?? Date.now;

  const visibleText = truncate(raw.visibleText, maxText);
  const textTruncated =
    raw.visibleText.length > maxText || raw.textTruncated;

  // Assign stable ids to interactive elements. Hidden elements are filtered
  // out unless `includeHidden` is set.
  const elements: InteractiveElement[] = [];
  const elementIndexMap = new Map<number, string>(); // raw index → stable id
  let visibleIndex = 0;
  let filteredCount = raw.filteredCount;

  for (let i = 0; i < raw.rawElements.length; i++) {
    const rawEl = raw.rawElements[i];
    if (!rawEl) continue;
    if (!includeHidden && rawEl.hidden) {
      filteredCount += 1;
      continue;
    }
    if (elements.length >= maxElements) {
      filteredCount += raw.rawElements.length - i;
      break;
    }
    const stableId = `el_${visibleIndex}`;
    elementIndexMap.set(i, stableId);
    elements.push(normalizeElement(rawEl, stableId));
    visibleIndex += 1;
  }

  // Normalize forms, mapping their element indices to the stable ids.
  const forms: FormSnapshot[] = [];
  let formIndex = 0;
  for (const rawForm of raw.rawForms) {
    if (!rawForm) continue;
    const formId = `form_${formIndex}`;
    const elementIds: string[] = [];
    for (const idx of rawForm.elementIndices) {
      const mapped = elementIndexMap.get(idx);
      if (mapped) elementIds.push(mapped);
    }
    forms.push({
      id: formId,
      action: rawForm.action,
      method: rawForm.method,
      name: rawForm.name,
      elementIds,
    });
    formIndex += 1;
  }

  return {
    id: opts.snapshotId,
    tabId: opts.tabId,
    takenAt: now(),
    url: raw.url,
    title: raw.title,
    visibleText,
    textTruncated,
    interactiveElements: elements,
    forms,
    filteredCount,
  };
}

// ---------------------------------------------------------------------------
// Element normalization
// ---------------------------------------------------------------------------

function normalizeElement(
  raw: RawInteractiveElement,
  stableId: string
): InteractiveElement {
  const role = mapRole(raw);
  const el: InteractiveElement = {
    id: stableId,
    role,
    accessibleName: truncate(raw.accessibleName ?? '', 200),
    disabled: !!raw.disabled,
    hidden: !!raw.hidden,
    tagName: (raw.tagName ?? '').toLowerCase(),
  };

  if (raw.href !== undefined && raw.href !== null) {
    el.href = truncate(raw.href, 500);
  }
  if (raw.inputType !== undefined && raw.inputType !== null) {
    el.inputType = String(raw.inputType).toLowerCase();
  }
  if (raw.placeholder !== undefined && raw.placeholder !== null) {
    el.placeholder = truncate(raw.placeholder, 200);
  }
  if (raw.checked !== undefined && raw.checked !== null) {
    el.checked = !!raw.checked;
  }
  if (raw.name !== undefined && raw.name !== null) {
    el.name = truncate(raw.name, 100);
  }

  // SECURITY: redact password and file values.
  if (el.inputType === 'password') {
    el.valueState = REDACTED_PASSWORD;
  } else if (el.inputType === 'file') {
    el.valueState = REDACTED_FILE;
  } else if (raw.value !== undefined && raw.value !== null) {
    el.valueState = truncate(String(raw.value), 500);
  }

  return el;
}

function mapRole(raw: RawInteractiveElement): ElementRole {
  const tag = (raw.tagName ?? '').toLowerCase();
  const inputType = (raw.inputType ?? '').toLowerCase();
  const roleAttr = (raw.role ?? '').toLowerCase();

  // Explicit role attribute wins for ARIA.
  if (roleAttr === 'button' || tag === 'button') return 'button';
  if (roleAttr === 'link' || tag === 'a') return 'link';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'option') return 'other';
  if (tag === 'input') {
    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'radio') return 'radio';
    if (inputType === 'submit') return 'submit';
    if (inputType === 'reset') return 'reset';
    if (inputType === 'image') return 'image';
    return 'input';
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  if (max <= 1) return '…';
  return s.slice(0, max - 1) + '…';
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// Snapshot id generator (deterministic for tests, unique for production)
// ---------------------------------------------------------------------------

let _snapCounter = 0;
export function generateSnapshotId(): string {
  _snapCounter += 1;
  return `snap_${Date.now().toString(36)}_${_snapCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Exported for tests
// ---------------------------------------------------------------------------

export const REDACTION = {
  PASSWORD: REDACTED_PASSWORD,
  FILE: REDACTED_FILE,
} as const;

export const DEFAULTS = {
  MAX_TEXT: DEFAULT_MAX_TEXT,
  MAX_ELEMENTS: DEFAULT_MAX_ELEMENTS,
} as const;
