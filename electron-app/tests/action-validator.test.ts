import { describe, it, expect } from 'vitest';
import {
  validateAction,
  BOUNDS,
  PATTERNS,
} from '../src/main/browser/actions/pure/action-validator';
import type { ActionInput } from '@shared/browser-actions-types';

// ===========================================================================
// Navigate
// ===========================================================================
describe('action-validator / navigate', () => {
  it('accepts a valid https URL', () => {
    const r = validateAction({
      kind: 'navigate',
      tabId: 'tab_1',
      url: 'https://example.com/',
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('accepts a bare hostname (upgraded to https)', () => {
    const r = validateAction({
      kind: 'navigate',
      tabId: 'tab_1',
      url: 'example.com',
    });
    expect(r.valid).toBe(true);
  });

  it('rejects empty tabId', () => {
    const r = validateAction({
      kind: 'navigate',
      tabId: '',
      url: 'https://example.com/',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'tabId')).toBe(true);
  });

  it('rejects javascript: URL', () => {
    const r = validateAction({
      kind: 'navigate',
      tabId: 'tab_1',
      url: 'javascript:alert(1)',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'url')).toBe(true);
  });

  it('rejects data: URL', () => {
    const r = validateAction({
      kind: 'navigate',
      tabId: 'tab_1',
      url: 'data:text/html,<script>1</script>',
    });
    expect(r.valid).toBe(false);
  });

  it('rejects blob: URL', () => {
    const r = validateAction({
      kind: 'navigate',
      tabId: 'tab_1',
      url: 'blob:https://example.com/abc',
    });
    expect(r.valid).toBe(false);
  });

  it('rejects empty url', () => {
    const r = validateAction({
      kind: 'navigate',
      tabId: 'tab_1',
      url: '',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'url')).toBe(true);
  });
});

// ===========================================================================
// readPage
// ===========================================================================
describe('action-validator / readPage', () => {
  it('accepts a valid tabId with no optional fields', () => {
    const r = validateAction({ kind: 'readPage', tabId: 'tab_1' });
    expect(r.valid).toBe(true);
  });

  it('rejects empty tabId', () => {
    const r = validateAction({ kind: 'readPage', tabId: '' });
    expect(r.valid).toBe(false);
  });

  it('rejects maxTextLength exceeding hard cap', () => {
    const r = validateAction({
      kind: 'readPage',
      tabId: 'tab_1',
      maxTextLength: BOUNDS.HARD_MAX_TEXT_LENGTH + 1,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'maxTextLength')).toBe(true);
  });

  it('accepts maxTextLength at hard cap', () => {
    const r = validateAction({
      kind: 'readPage',
      tabId: 'tab_1',
      maxTextLength: BOUNDS.HARD_MAX_TEXT_LENGTH,
    });
    expect(r.valid).toBe(true);
  });

  it('rejects negative maxTextLength', () => {
    const r = validateAction({
      kind: 'readPage',
      tabId: 'tab_1',
      maxTextLength: -1,
    });
    expect(r.valid).toBe(false);
  });

  it('rejects NaN maxTextLength', () => {
    const r = validateAction({
      kind: 'readPage',
      tabId: 'tab_1',
      maxTextLength: NaN,
    });
    expect(r.valid).toBe(false);
  });

  it('rejects maxElements exceeding hard cap', () => {
    const r = validateAction({
      kind: 'readPage',
      tabId: 'tab_1',
      maxElements: BOUNDS.HARD_MAX_ELEMENTS + 1,
    });
    expect(r.valid).toBe(false);
  });
});

// ===========================================================================
// listTabs / openTab / activateTab / closeTab
// ===========================================================================
describe('action-validator / listTabs', () => {
  it('always accepts (no fields)', () => {
    expect(validateAction({ kind: 'listTabs' }).valid).toBe(true);
  });
});

describe('action-validator / openTab', () => {
  it('accepts with no fields', () => {
    expect(validateAction({ kind: 'openTab' }).valid).toBe(true);
  });

  it('accepts a valid url', () => {
    expect(
      validateAction({ kind: 'openTab', url: 'https://example.com/' }).valid
    ).toBe(true);
  });

  it('accepts empty url (about:blank default)', () => {
    expect(validateAction({ kind: 'openTab', url: '' }).valid).toBe(true);
  });

  it('rejects javascript: url', () => {
    expect(
      validateAction({ kind: 'openTab', url: 'javascript:alert(1)' }).valid
    ).toBe(false);
  });

  it('rejects non-boolean activate', () => {
    const r = validateAction({
      kind: 'openTab',
      activate: 'yes' as unknown as boolean,
    });
    expect(r.valid).toBe(false);
  });

  it('rejects non-boolean incognito', () => {
    const r = validateAction({
      kind: 'openTab',
      incognito: 1 as unknown as boolean,
    });
    expect(r.valid).toBe(false);
  });
});

describe('action-validator / activateTab', () => {
  it('accepts valid tabId', () => {
    expect(
      validateAction({ kind: 'activateTab', tabId: 'tab_1' }).valid
    ).toBe(true);
  });
  it('rejects empty tabId', () => {
    expect(
      validateAction({ kind: 'activateTab', tabId: '' }).valid
    ).toBe(false);
  });
});

describe('action-validator / closeTab', () => {
  it('accepts valid tabId', () => {
    expect(
      validateAction({ kind: 'closeTab', tabId: 'tab_1' }).valid
    ).toBe(true);
  });
  it('rejects empty tabId', () => {
    expect(
      validateAction({ kind: 'closeTab', tabId: ' ' }).valid
    ).toBe(false);
  });
});

// ===========================================================================
// click / type
// ===========================================================================
describe('action-validator / click', () => {
  it('accepts valid tabId + elementId', () => {
    expect(
      validateAction({ kind: 'click', tabId: 'tab_1', elementId: 'el_0' }).valid
    ).toBe(true);
  });

  it('rejects malformed elementId', () => {
    const r = validateAction({
      kind: 'click',
      tabId: 'tab_1',
      elementId: 'element_5',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'elementId')).toBe(true);
  });

  it('rejects LLM-supplied CSS selector', () => {
    const r = validateAction({
      kind: 'click',
      tabId: 'tab_1',
      elementId: '#submit-button',
    });
    expect(r.valid).toBe(false);
  });

  it('rejects LLM-supplied XPath', () => {
    const r = validateAction({
      kind: 'click',
      tabId: 'tab_1',
      elementId: '/html/body/form/button[1]',
    });
    expect(r.valid).toBe(false);
  });

  it('rejects empty tabId', () => {
    expect(
      validateAction({ kind: 'click', tabId: '', elementId: 'el_0' }).valid
    ).toBe(false);
  });
});

describe('action-validator / type', () => {
  it('accepts valid input', () => {
    expect(
      validateAction({
        kind: 'type',
        tabId: 'tab_1',
        elementId: 'el_1',
        text: 'hello',
      }).valid
    ).toBe(true);
  });

  it('rejects malformed elementId', () => {
    expect(
      validateAction({
        kind: 'type',
        tabId: 'tab_1',
        elementId: 'input[name="q"]',
        text: 'hello',
      }).valid
    ).toBe(false);
  });

  it('rejects text exceeding max length', () => {
    const r = validateAction({
      kind: 'type',
      tabId: 'tab_1',
      elementId: 'el_1',
      text: 'x'.repeat(BOUNDS.MAX_TYPE_LENGTH + 1),
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'text')).toBe(true);
  });

  it('accepts text at max length', () => {
    expect(
      validateAction({
        kind: 'type',
        tabId: 'tab_1',
        elementId: 'el_1',
        text: 'x'.repeat(BOUNDS.MAX_TYPE_LENGTH),
      }).valid
    ).toBe(true);
  });

  it('rejects non-string text', () => {
    const r = validateAction({
      kind: 'type',
      tabId: 'tab_1',
      elementId: 'el_1',
      text: 123 as unknown as string,
    });
    expect(r.valid).toBe(false);
  });

  it('rejects non-boolean clearFirst', () => {
    const r = validateAction({
      kind: 'type',
      tabId: 'tab_1',
      elementId: 'el_1',
      text: 'hello',
      clearFirst: 'yes' as unknown as boolean,
    });
    expect(r.valid).toBe(false);
  });
});

// ===========================================================================
// scroll
// ===========================================================================
describe('action-validator / scroll', () => {
  it('accepts valid input', () => {
    expect(
      validateAction({
        kind: 'scroll',
        tabId: 'tab_1',
        direction: 'down',
        amount: 400,
      }).valid
    ).toBe(true);
  });

  it('accepts missing amount (defaults at router)', () => {
    expect(
      validateAction({
        kind: 'scroll',
        tabId: 'tab_1',
        direction: 'up',
      }).valid
    ).toBe(true);
  });

  it('rejects invalid direction', () => {
    const r = validateAction({
      kind: 'scroll',
      tabId: 'tab_1',
      direction: 'sideways' as 'up',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'direction')).toBe(true);
  });

  it('rejects amount exceeding cap', () => {
    const r = validateAction({
      kind: 'scroll',
      tabId: 'tab_1',
      direction: 'down',
      amount: BOUNDS.MAX_SCROLL_AMOUNT + 1,
    });
    expect(r.valid).toBe(false);
  });

  it('rejects negative amount', () => {
    const r = validateAction({
      kind: 'scroll',
      tabId: 'tab_1',
      direction: 'down',
      amount: -100,
    });
    expect(r.valid).toBe(false);
  });

  it('rejects NaN amount', () => {
    const r = validateAction({
      kind: 'scroll',
      tabId: 'tab_1',
      direction: 'down',
      amount: NaN,
    });
    expect(r.valid).toBe(false);
  });

  it('rejects empty tabId', () => {
    expect(
      validateAction({
        kind: 'scroll',
        tabId: '',
        direction: 'down',
      }).valid
    ).toBe(false);
  });
});

// ===========================================================================
// stop
// ===========================================================================
describe('action-validator / stop', () => {
  it('accepts with no fields', () => {
    expect(validateAction({ kind: 'stop' }).valid).toBe(true);
  });

  it('accepts a valid executionId', () => {
    expect(
      validateAction({ kind: 'stop', executionId: 'exec_1' }).valid
    ).toBe(true);
  });

  it('rejects malformed executionId', () => {
    const r = validateAction({ kind: 'stop', executionId: 'foobar' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'executionId')).toBe(true);
  });

  it('accepts a reason', () => {
    expect(
      validateAction({ kind: 'stop', reason: 'user_request' }).valid
    ).toBe(true);
  });

  it('rejects reason exceeding 200 chars', () => {
    const r = validateAction({ kind: 'stop', reason: 'x'.repeat(201) });
    expect(r.valid).toBe(false);
  });
});

// ===========================================================================
// Patterns export
// ===========================================================================
describe('action-validator / patterns', () => {
  it('exposes the element-id pattern', () => {
    expect(PATTERNS.ELEMENT_ID.test('el_0')).toBe(true);
    expect(PATTERNS.ELEMENT_ID.test('el_42')).toBe(true);
    expect(PATTERNS.ELEMENT_ID.test('el_abc')).toBe(false);
    expect(PATTERNS.ELEMENT_ID.test('element_0')).toBe(false);
  });

  it('exposes the form-id pattern', () => {
    expect(PATTERNS.FORM_ID.test('form_0')).toBe(true);
    expect(PATTERNS.FORM_ID.test('form_42')).toBe(true);
  });

  it('exposes the execution-id pattern', () => {
    expect(PATTERNS.EXECUTION_ID.test('exec_1')).toBe(true);
    expect(PATTERNS.EXECUTION_ID.test('exec_abc')).toBe(false);
  });
});

// ===========================================================================
// Exhaustiveness — TypeScript ensures all 10 action kinds are covered.
// ===========================================================================
describe('action-validator / exhaustive coverage', () => {
  const allKinds: ActionInput['kind'][] = [
    'navigate',
    'readPage',
    'listTabs',
    'openTab',
    'activateTab',
    'closeTab',
    'click',
    'type',
    'scroll',
    'stop',
  ];
  for (const kind of allKinds) {
    it(`validates kind="${kind}" without throwing`, () => {
      const input = minimalValidInput(kind);
      expect(() => validateAction(input)).not.toThrow();
    });
  }
});

function minimalValidInput(kind: ActionInput['kind']): ActionInput {
  switch (kind) {
    case 'navigate':
      return { kind, tabId: 'tab_1', url: 'https://example.com/' };
    case 'readPage':
      return { kind, tabId: 'tab_1' };
    case 'listTabs':
      return { kind };
    case 'openTab':
      return { kind };
    case 'activateTab':
      return { kind, tabId: 'tab_1' };
    case 'closeTab':
      return { kind, tabId: 'tab_1' };
    case 'click':
      return { kind, tabId: 'tab_1', elementId: 'el_0' };
    case 'type':
      return { kind, tabId: 'tab_1', elementId: 'el_1', text: 'x' };
    case 'scroll':
      return { kind, tabId: 'tab_1', direction: 'down', amount: 100 };
    case 'stop':
      return { kind };
  }
}
