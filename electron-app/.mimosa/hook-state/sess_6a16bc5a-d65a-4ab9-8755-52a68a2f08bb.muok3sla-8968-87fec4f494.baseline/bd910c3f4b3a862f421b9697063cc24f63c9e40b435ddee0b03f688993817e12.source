/**
 * Action validator — pure logic (no electron, no React).
 *
 * Validates every `ActionInput` BEFORE it reaches the runtime adapter.
 * Validation rules are explicit and deterministic so they can be unit-tested.
 *
 * SECURITY:
 *   - URL inputs are validated against the same protocol whitelist as the
 *     address bar (javascript:, data:, vbscript:, blob: are rejected).
 *   - `text` length is bounded to prevent runaway LLM payloads.
 *   - `amount` is bounded to prevent scroll bombs.
 *   - Element ids must match the stable-id format assigned by the snapshot
 *     normalizer (`el_<n>` or `form_<n>`).
 */
import type {
  ActionInput,
  ValidationResult,
  ValidationError,
  NavigateActionInput,
  ReadPageActionInput,
  ListTabsActionInput,
  OpenTabActionInput,
  ActivateTabActionInput,
  CloseTabActionInput,
  ClickActionInput,
  TypeActionInput,
  ScrollActionInput,
  ScreenshotActionInput,
  StopActionInput,
} from '@shared/browser-actions-types';
import { isValidUrl, isAddressBarSafe } from '../../pure/url-utils';

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------
const MAX_TEXT_LENGTH = 10_000;
const HARD_MAX_TEXT_LENGTH = 50_000;
const MAX_ELEMENTS = 200;
const HARD_MAX_ELEMENTS = 1000;
const MAX_SCROLL_AMOUNT = 10_000;
const MAX_TYPE_LENGTH = 10_000;

const ELEMENT_ID_PATTERN = /^el_\d+$/;
const FORM_ID_PATTERN = /^form_\d+$/;
const EXECUTION_ID_PATTERN = /^exec_\d+$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function validateAction(input: ActionInput): ValidationResult {
  switch (input.kind) {
    case 'navigate':
      return validateNavigate(input);
    case 'readPage':
      return validateReadPage(input);
    case 'listTabs':
      return validateListTabs(input);
    case 'openTab':
      return validateOpenTab(input);
    case 'activateTab':
      return validateActivateTab(input);
    case 'closeTab':
      return validateCloseTab(input);
    case 'click':
      return validateClick(input);
    case 'type':
      return validateType(input);
    case 'scroll':
      return validateScroll(input);
    case 'screenshot':
      return validateScreenshot(input);
    case 'stop':
      return validateStop(input);
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-action validators
// ---------------------------------------------------------------------------

function validateNavigate(input: NavigateActionInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isNonEmptyString(input.tabId)) {
    errors.push({ field: 'tabId', message: 'tabId must be a non-empty string' });
  }
  if (!isNonEmptyString(input.url)) {
    errors.push({ field: 'url', message: 'url must be a non-empty string' });
  } else if (!isAddressBarSafe(input.url)) {
    errors.push({
      field: 'url',
      message: `url protocol is not allowed from action layer: ${input.url}`,
    });
  } else if (!isValidUrl(normalizeIfBare(input.url))) {
    errors.push({
      field: 'url',
      message: `url is not a valid URL: ${input.url}`,
    });
  }
  return { valid: errors.length === 0, errors };
}

function validateReadPage(input: ReadPageActionInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isNonEmptyString(input.tabId)) {
    errors.push({ field: 'tabId', message: 'tabId must be a non-empty string' });
  }
  if (input.maxTextLength !== undefined) {
    if (!Number.isFinite(input.maxTextLength) || input.maxTextLength < 0) {
      errors.push({ field: 'maxTextLength', message: 'maxTextLength must be a non-negative finite number' });
    } else if (input.maxTextLength > HARD_MAX_TEXT_LENGTH) {
      errors.push({
        field: 'maxTextLength',
        message: `maxTextLength exceeds hard cap of ${HARD_MAX_TEXT_LENGTH}`,
      });
    }
  }
  if (input.maxElements !== undefined) {
    if (!Number.isFinite(input.maxElements) || input.maxElements < 0) {
      errors.push({ field: 'maxElements', message: 'maxElements must be a non-negative finite number' });
    } else if (input.maxElements > HARD_MAX_ELEMENTS) {
      errors.push({
        field: 'maxElements',
        message: `maxElements exceeds hard cap of ${HARD_MAX_ELEMENTS}`,
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateListTabs(_input: ListTabsActionInput): ValidationResult {
  return { valid: true, errors: [] };
}

function validateOpenTab(input: OpenTabActionInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (input.url !== undefined) {
    if (typeof input.url !== 'string') {
      errors.push({ field: 'url', message: 'url must be a string when provided' });
    } else if (input.url.length > 0) {
      if (!isAddressBarSafe(input.url)) {
        errors.push({
          field: 'url',
          message: `url protocol is not allowed: ${input.url}`,
        });
      } else if (!isValidUrl(normalizeIfBare(input.url))) {
        errors.push({
          field: 'url',
          message: `url is not valid: ${input.url}`,
        });
      }
    }
  }
  if (input.activate !== undefined && typeof input.activate !== 'boolean') {
    errors.push({ field: 'activate', message: 'activate must be a boolean when provided' });
  }
  if (input.incognito !== undefined && typeof input.incognito !== 'boolean') {
    errors.push({ field: 'incognito', message: 'incognito must be a boolean when provided' });
  }
  return { valid: errors.length === 0, errors };
}

function validateActivateTab(input: ActivateTabActionInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isNonEmptyString(input.tabId)) {
    errors.push({ field: 'tabId', message: 'tabId must be a non-empty string' });
  }
  return { valid: errors.length === 0, errors };
}

function validateCloseTab(input: CloseTabActionInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isNonEmptyString(input.tabId)) {
    errors.push({ field: 'tabId', message: 'tabId must be a non-empty string' });
  }
  return { valid: errors.length === 0, errors };
}

function validateClick(input: ClickActionInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isNonEmptyString(input.tabId)) {
    errors.push({ field: 'tabId', message: 'tabId must be a non-empty string' });
  }
  if (!isNonEmptyString(input.elementId)) {
    errors.push({ field: 'elementId', message: 'elementId must be a non-empty string' });
  } else if (!ELEMENT_ID_PATTERN.test(input.elementId)) {
    errors.push({
      field: 'elementId',
      message: `elementId must match ${ELEMENT_ID_PATTERN.source} (stable id from PageSnapshot)`,
    });
  }
  return { valid: errors.length === 0, errors };
}

function validateType(input: TypeActionInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isNonEmptyString(input.tabId)) {
    errors.push({ field: 'tabId', message: 'tabId must be a non-empty string' });
  }
  if (!isNonEmptyString(input.elementId)) {
    errors.push({ field: 'elementId', message: 'elementId must be a non-empty string' });
  } else if (!ELEMENT_ID_PATTERN.test(input.elementId)) {
    errors.push({
      field: 'elementId',
      message: `elementId must match ${ELEMENT_ID_PATTERN.source}`,
    });
  }
  if (typeof input.text !== 'string') {
    errors.push({ field: 'text', message: 'text must be a string' });
  } else if (input.text.length > MAX_TYPE_LENGTH) {
    errors.push({
      field: 'text',
      message: `text length ${input.text.length} exceeds max of ${MAX_TYPE_LENGTH}`,
    });
  }
  if (input.clearFirst !== undefined && typeof input.clearFirst !== 'boolean') {
    errors.push({ field: 'clearFirst', message: 'clearFirst must be a boolean when provided' });
  }
  return { valid: errors.length === 0, errors };
}

function validateScroll(input: ScrollActionInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isNonEmptyString(input.tabId)) {
    errors.push({ field: 'tabId', message: 'tabId must be a non-empty string' });
  }
  const allowedDirections = ['up', 'down', 'left', 'right'];
  if (!allowedDirections.includes(input.direction)) {
    errors.push({
      field: 'direction',
      message: `direction must be one of ${allowedDirections.join(', ')}`,
    });
  }
  if (input.amount !== undefined) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      errors.push({ field: 'amount', message: 'amount must be a positive finite number when provided' });
    } else if (input.amount > MAX_SCROLL_AMOUNT) {
      errors.push({
        field: 'amount',
        message: `amount ${input.amount} exceeds max of ${MAX_SCROLL_AMOUNT}`,
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

const MAX_SCREENSHOT_WIDTH = 1600;

function validateScreenshot(input: ScreenshotActionInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isNonEmptyString(input.tabId)) {
    errors.push({ field: 'tabId', message: 'tabId must be a non-empty string' });
  }
  if (input.maxWidth !== undefined) {
    if (!Number.isFinite(input.maxWidth) || input.maxWidth < 320) {
      errors.push({
        field: 'maxWidth',
        message: 'maxWidth must be a number >= 320 when provided',
      });
    } else if (input.maxWidth > MAX_SCREENSHOT_WIDTH) {
      errors.push({
        field: 'maxWidth',
        message: `maxWidth ${input.maxWidth} exceeds max of ${MAX_SCREENSHOT_WIDTH}`,
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateStop(input: StopActionInput): ValidationResult {
  const errors: ValidationError[] = [];
  if (input.executionId !== undefined) {
    if (typeof input.executionId !== 'string') {
      errors.push({ field: 'executionId', message: 'executionId must be a string when provided' });
    } else if (input.executionId.length > 0 && !EXECUTION_ID_PATTERN.test(input.executionId)) {
      errors.push({
        field: 'executionId',
        message: `executionId must match ${EXECUTION_ID_PATTERN.source} or be empty`,
      });
    }
  }
  if (input.reason !== undefined) {
    if (typeof input.reason !== 'string') {
      errors.push({ field: 'reason', message: 'reason must be a string when provided' });
    } else if (input.reason.length > 200) {
      errors.push({ field: 'reason', message: 'reason length exceeds 200 characters' });
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Bare hostnames (no protocol) are upgraded to https:// before protocol
 * validation. This mirrors the address-bar normalization in url-utils.
 */
function normalizeIfBare(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return input;
  // Already has a protocol?
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// ---------------------------------------------------------------------------
// Exported bounds (for tests)
// ---------------------------------------------------------------------------
export const BOUNDS = {
  MAX_TEXT_LENGTH,
  HARD_MAX_TEXT_LENGTH,
  MAX_ELEMENTS,
  HARD_MAX_ELEMENTS,
  MAX_SCROLL_AMOUNT,
  MAX_TYPE_LENGTH,
} as const;

export const PATTERNS = {
  ELEMENT_ID: ELEMENT_ID_PATTERN,
  FORM_ID: FORM_ID_PATTERN,
  EXECUTION_ID: EXECUTION_ID_PATTERN,
} as const;
