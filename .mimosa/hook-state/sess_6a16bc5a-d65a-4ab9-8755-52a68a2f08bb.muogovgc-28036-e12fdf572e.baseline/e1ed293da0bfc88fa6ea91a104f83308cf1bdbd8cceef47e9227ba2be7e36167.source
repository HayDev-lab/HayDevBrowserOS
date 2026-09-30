import { describe, it, expect } from 'vitest';
import {
  normalizeSnapshot,
  generateSnapshotId,
  REDACTION,
  DEFAULTS,
} from '../src/main/browser/actions/pure/snapshot-normalizer';
import type {
  RawPageData,
  RawInteractiveElement,
  RawForm,
} from '@shared/browser-actions-types';
import { makeRawElement, makeRawForm, defaultRawPage } from './_fake-adapter';

// ===========================================================================
// Stable IDs
// ===========================================================================
describe('snapshot-normalizer / stable ids', () => {
  it('assigns el_<index> ids in DOM order', () => {
    const raw: RawPageData = {
      url: 'https://example.com/',
      title: 'Example',
      visibleText: 'text',
      textTruncated: false,
      rawElements: [
        makeRawElement({ tagName: 'A', accessibleName: 'First' }),
        makeRawElement({ tagName: 'BUTTON', accessibleName: 'Second' }),
        makeRawElement({ tagName: 'INPUT', accessibleName: 'Third' }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
      now: () => 1000,
    });
    expect(snap.interactiveElements.map((e) => e.id)).toEqual([
      'el_0',
      'el_1',
      'el_2',
    ]);
  });

  it('assigns form_<index> ids', () => {
    const raw: RawPageData = {
      url: 'https://example.com/',
      title: 'Example',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({ tagName: 'INPUT', accessibleName: 'a' }),
        makeRawElement({ tagName: 'INPUT', accessibleName: 'b' }),
      ],
      rawForms: [
        makeRawForm({ elementIndices: [0, 1], action: '/submit', method: 'post' }),
      ],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.forms[0].id).toBe('form_0');
    expect(snap.forms[0].elementIds).toEqual(['el_0', 'el_1']);
  });

  it('skips hidden elements by default', () => {
    const raw: RawPageData = {
      url: 'https://example.com/',
      title: 'Example',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({ tagName: 'A', accessibleName: 'Visible', hidden: false }),
        makeRawElement({ tagName: 'A', accessibleName: 'Hidden', hidden: true }),
        makeRawElement({ tagName: 'A', accessibleName: 'Also visible', hidden: false }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.interactiveElements.length).toBe(2);
    expect(snap.interactiveElements[0].accessibleName).toBe('Visible');
    expect(snap.interactiveElements[1].accessibleName).toBe('Also visible');
    expect(snap.filteredCount).toBe(1);
  });

  it('includes hidden elements when includeHidden is true', () => {
    const raw: RawPageData = {
      url: 'https://example.com/',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({ tagName: 'A', accessibleName: 'Visible', hidden: false }),
        makeRawElement({ tagName: 'A', accessibleName: 'Hidden', hidden: true }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
      includeHidden: true,
    });
    expect(snap.interactiveElements.length).toBe(2);
    expect(snap.filteredCount).toBe(0);
  });

  it('respects maxElements cap', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: Array.from({ length: 10 }, (_, i) =>
        makeRawElement({ tagName: 'A', accessibleName: `Link ${i}` })
      ),
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
      maxElements: 3,
    });
    expect(snap.interactiveElements.length).toBe(3);
    expect(snap.filteredCount).toBe(7);
  });
});

// ===========================================================================
// Password redaction (CRITICAL SECURITY)
// ===========================================================================
describe('snapshot-normalizer / password redaction', () => {
  it('redacts password field values', () => {
    const raw: RawPageData = {
      url: 'https://example.com/login',
      title: 'Login',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({
          tagName: 'INPUT',
          inputType: 'password',
          value: 'supersecret123',
          accessibleName: 'Password',
        }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    const el = snap.interactiveElements[0];
    expect(el.valueState).toBe(REDACTION.PASSWORD);
    // Ensure the raw value is NOT in the snapshot.
    expect(JSON.stringify(snap)).not.toContain('supersecret123');
  });

  it('redacts file input values', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({
          tagName: 'INPUT',
          inputType: 'file',
          value: 'C:\\Users\\secret\\file.txt',
          accessibleName: 'Upload',
        }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.interactiveElements[0].valueState).toBe(REDACTION.FILE);
    expect(JSON.stringify(snap)).not.toContain('C:\\Users\\secret');
  });

  it('passes through non-sensitive input values', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({
          tagName: 'INPUT',
          inputType: 'text',
          value: 'hello world',
          accessibleName: 'Search',
        }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.interactiveElements[0].valueState).toBe('hello world');
  });

  it('redacts even when raw value is empty string for password', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({
          tagName: 'INPUT',
          inputType: 'password',
          value: '',
          accessibleName: 'Password',
        }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.interactiveElements[0].valueState).toBe(REDACTION.PASSWORD);
  });

  it('redacts multiple password fields in one snapshot', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({
          tagName: 'INPUT',
          inputType: 'password',
          value: 'pw1',
          accessibleName: 'Password 1',
        }),
        makeRawElement({
          tagName: 'INPUT',
          inputType: 'password',
          value: 'pw2',
          accessibleName: 'Password 2',
        }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.interactiveElements[0].valueState).toBe(REDACTION.PASSWORD);
    expect(snap.interactiveElements[1].valueState).toBe(REDACTION.PASSWORD);
    expect(JSON.stringify(snap)).not.toContain('pw1');
    expect(JSON.stringify(snap)).not.toContain('pw2');
  });
});

// ===========================================================================
// Disabled elements
// ===========================================================================
describe('snapshot-normalizer / disabled elements', () => {
  it('marks disabled elements as disabled=true', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({ tagName: 'BUTTON', disabled: true, accessibleName: 'Disabled btn' }),
        makeRawElement({ tagName: 'BUTTON', disabled: false, accessibleName: 'Enabled btn' }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.interactiveElements[0].disabled).toBe(true);
    expect(snap.interactiveElements[1].disabled).toBe(false);
  });
});

// ===========================================================================
// Role mapping
// ===========================================================================
describe('snapshot-normalizer / role mapping', () => {
  it('maps anchor to link', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({ tagName: 'A', href: 'https://x.com/' }),
        makeRawElement({ tagName: 'BUTTON' }),
        makeRawElement({ tagName: 'SELECT' }),
        makeRawElement({ tagName: 'TEXTAREA' }),
        makeRawElement({ tagName: 'INPUT', inputType: 'checkbox' }),
        makeRawElement({ tagName: 'INPUT', inputType: 'radio' }),
        makeRawElement({ tagName: 'INPUT', inputType: 'submit' }),
        makeRawElement({ tagName: 'INPUT', inputType: 'text' }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    const roles = snap.interactiveElements.map((e) => e.role);
    expect(roles).toEqual([
      'link',
      'button',
      'select',
      'textarea',
      'checkbox',
      'radio',
      'submit',
      'input',
    ]);
  });

  it('respects ARIA role attribute over tag', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({ tagName: 'DIV', role: 'button', accessibleName: 'Custom btn' }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.interactiveElements[0].role).toBe('button');
  });
});

// ===========================================================================
// Text truncation
// ===========================================================================
describe('snapshot-normalizer / text truncation', () => {
  it('truncates visible text to maxTextLength', () => {
    const longText = 'x'.repeat(1000);
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: longText,
      textTruncated: false,
      rawElements: [],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
      maxTextLength: 100,
    });
    expect(snap.visibleText.length).toBe(100);
    expect(snap.textTruncated).toBe(true);
  });

  it('marks textTruncated when raw already reported truncation', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: 'short',
      textTruncated: true,
      rawElements: [],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
      maxTextLength: 1000,
    });
    expect(snap.textTruncated).toBe(true);
  });

  it('uses default max when not specified', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: 'x'.repeat(DEFAULTS.MAX_TEXT - 1),
      textTruncated: false,
      rawElements: [],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.textTruncated).toBe(false);
  });
});

// ===========================================================================
// Forms
// ===========================================================================
describe('snapshot-normalizer / forms', () => {
  it('maps form elementIndices to stable element ids', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({ tagName: 'INPUT', accessibleName: 'a' }),
        makeRawElement({ tagName: 'INPUT', accessibleName: 'b' }),
        makeRawElement({ tagName: 'BUTTON', accessibleName: 'submit' }),
      ],
      rawForms: [
        makeRawForm({
          action: '/login',
          method: 'post',
          name: 'loginForm',
          elementIndices: [0, 1, 2],
        }),
      ],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.forms.length).toBe(1);
    expect(snap.forms[0].action).toBe('/login');
    expect(snap.forms[0].method).toBe('post');
    expect(snap.forms[0].name).toBe('loginForm');
    expect(snap.forms[0].elementIds).toEqual(['el_0', 'el_1', 'el_2']);
  });

  it('skips hidden elements when mapping form membership', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({ tagName: 'INPUT', accessibleName: 'a', hidden: false }),
        makeRawElement({ tagName: 'INPUT', accessibleName: 'b', hidden: true }),
        makeRawElement({ tagName: 'BUTTON', accessibleName: 'submit', hidden: false }),
      ],
      rawForms: [
        makeRawForm({
          elementIndices: [0, 1, 2],
        }),
      ],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    // Hidden element (index 1) is filtered out → form has only 2 element ids.
    expect(snap.forms[0].elementIds).toEqual(['el_0', 'el_1']);
  });
});

// ===========================================================================
// Default raw page fixture
// ===========================================================================
describe('snapshot-normalizer / default fixture', () => {
  it('normalizes the default raw page from the fake adapter', () => {
    const snap = normalizeSnapshot(defaultRawPage('https://example.com/'), {
      snapshotId: generateSnapshotId(),
      tabId: 'tab_1',
    });
    expect(snap.url).toBe('https://example.com/');
    expect(snap.title).toBe('Example Page');
    expect(snap.interactiveElements.length).toBe(4);
    expect(snap.forms.length).toBe(1);
    // The 3rd element (index 2) is a password field — must be redacted.
    const passwordEl = snap.interactiveElements[2];
    expect(passwordEl.inputType).toBe('password');
    expect(passwordEl.valueState).toBe(REDACTION.PASSWORD);
  });
});

// ===========================================================================
// Field truncation
// ===========================================================================
describe('snapshot-normalizer / field truncation', () => {
  it('truncates long accessible names', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({
          tagName: 'A',
          accessibleName: 'x'.repeat(500),
        }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.interactiveElements[0].accessibleName.length).toBe(200);
    expect(snap.interactiveElements[0].accessibleName.endsWith('…')).toBe(true);
  });

  it('truncates long hrefs', () => {
    const raw: RawPageData = {
      url: '',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [
        makeRawElement({
          tagName: 'A',
          href: 'https://example.com/' + 'x'.repeat(1000),
        }),
      ],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.interactiveElements[0].href!.length).toBe(500);
  });
});

// ===========================================================================
// generateSnapshotId
// ===========================================================================
describe('snapshot-normalizer / generateSnapshotId', () => {
  it('produces unique ids across rapid calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateSnapshotId());
    }
    expect(ids.size).toBe(1000);
  });

  it('starts with snap_', () => {
    expect(generateSnapshotId().startsWith('snap_')).toBe(true);
  });
});

// ===========================================================================
// Empty page
// ===========================================================================
describe('snapshot-normalizer / empty page', () => {
  it('handles a page with no interactive elements', () => {
    const raw: RawPageData = {
      url: 'about:blank',
      title: '',
      visibleText: '',
      textTruncated: false,
      rawElements: [],
      rawForms: [],
      filteredCount: 0,
    };
    const snap = normalizeSnapshot(raw, {
      snapshotId: 'snap_test',
      tabId: 'tab_1',
    });
    expect(snap.interactiveElements).toEqual([]);
    expect(snap.forms).toEqual([]);
    expect(snap.filteredCount).toBe(0);
  });
});
