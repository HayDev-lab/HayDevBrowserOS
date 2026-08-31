/**
 * Fake ActionRuntimeAdapter — test fixture for unit/integration tests.
 *
 * Records every call so tests can assert dispatch routing.
 * Allows configuring per-tab responses and thrown errors.
 *
 * NOT a mock of Electron — it implements the pure `ActionRuntimeAdapter`
 * interface from `@shared/browser-actions-types`.
 */
import type {
  ActionRuntimeAdapter,
  RawPageData,
  RawInteractiveElement,
  RawForm,
} from '@shared/browser-actions-types';
import { ActionError } from '../src/main/browser/actions/pure/action-router';

export interface FakeAdapterCall {
  method: 'navigate' | 'readPageRaw' | 'click' | 'type' | 'scroll';
  args: unknown[];
}

export interface FakeTabConfig {
  /** URL to return from `navigate` and `readPageRaw`. */
  url?: string;
  /** Raw page data to return from `readPageRaw`. */
  rawPage?: RawPageData;
  /** Whether `click` should report the element as found+clickable. */
  clickResults?: Map<string, { found: boolean; disabled: boolean; clicked: boolean }>;
  /** Whether `type` should report the element as editable. */
  typeResults?: Map<
    string,
    { found: boolean; editable: boolean; charactersTyped: number; wasPasswordField: boolean }
  >;
  /** Whether `scroll` should succeed. */
  scrollSucceeds?: boolean;
  /** Whether `navigate` should throw. */
  navigateFails?: boolean;
}

export class FakeActionAdapter implements ActionRuntimeAdapter {
  public readonly calls: FakeAdapterCall[] = [];
  public readonly tabs = new Map<string, FakeTabConfig>();

  configureTab(tabId: string, config: FakeTabConfig): void {
    this.tabs.set(tabId, config);
  }

  async navigate(tabId: string, url: string): Promise<string> {
    this.calls.push({ method: 'navigate', args: [tabId, url] });
    const cfg = this.tabs.get(tabId);
    if (cfg?.navigateFails) {
      throw new ActionError('navigate_failed', `tab:${tabId},simulated`);
    }
    const finalUrl = cfg?.url ?? url;
    if (cfg) cfg.url = finalUrl;
    return finalUrl;
  }

  async readPageRaw(
    tabId: string,
    opts: { maxTextLength: number; maxElements: number }
  ): Promise<RawPageData> {
    this.calls.push({ method: 'readPageRaw', args: [tabId, opts] });
    const cfg = this.tabs.get(tabId);
    if (cfg?.rawPage) return cfg.rawPage;
    return defaultRawPage(cfg?.url ?? 'about:blank');
  }

  async click(tabId: string, elementId: string): Promise<boolean> {
    this.calls.push({ method: 'click', args: [tabId, elementId] });
    const cfg = this.tabs.get(tabId);
    const result = cfg?.clickResults?.get(elementId);
    if (!result) {
      throw new ActionError('element_not_found', `tab:${tabId},element:${elementId}`);
    }
    if (!result.found) {
      throw new ActionError('element_not_found', `tab:${tabId},element:${elementId}`);
    }
    if (result.disabled) {
      throw new ActionError('element_disabled', `tab:${tabId},element:${elementId}`);
    }
    return result.clicked;
  }

  async type(
    tabId: string,
    elementId: string,
    text: string,
    clearFirst: boolean
  ): Promise<{ charactersTyped: number; wasPasswordField: boolean }> {
    this.calls.push({ method: 'type', args: [tabId, elementId, text, clearFirst] });
    const cfg = this.tabs.get(tabId);
    const result = cfg?.typeResults?.get(elementId);
    if (!result) {
      throw new ActionError('element_not_found', `tab:${tabId},element:${elementId}`);
    }
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
  }

  async scroll(
    tabId: string,
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number
  ): Promise<boolean> {
    this.calls.push({ method: 'scroll', args: [tabId, direction, amount] });
    const cfg = this.tabs.get(tabId);
    return cfg?.scrollSucceeds ?? true;
  }

  /** Test helper: count calls of a specific method. */
  callsOf(method: FakeAdapterCall['method']): FakeAdapterCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /** Test helper: reset all recorded calls. */
  reset(): void {
    this.calls.length = 0;
    this.tabs.clear();
  }
}

// ---------------------------------------------------------------------------
// Default raw page (used when no `rawPage` is configured for a tab)
// ---------------------------------------------------------------------------

export function defaultRawPage(url: string = 'https://example.com/'): RawPageData {
  return {
    url,
    title: 'Example Page',
    visibleText: 'Welcome to the example page.',
    textTruncated: false,
    rawElements: [
      {
        tagName: 'A',
        role: '',
        accessibleName: 'Home',
        disabled: false,
        hidden: false,
        href: 'https://example.com/',
      },
      {
        tagName: 'INPUT',
        role: '',
        accessibleName: 'Search',
        disabled: false,
        hidden: false,
        inputType: 'text',
        placeholder: 'Type here',
        value: '',
        name: 'q',
      },
      {
        tagName: 'INPUT',
        role: '',
        accessibleName: 'Password',
        disabled: false,
        hidden: false,
        inputType: 'password',
        value: 'supersecret',
        name: 'pw',
      },
      {
        tagName: 'BUTTON',
        role: '',
        accessibleName: 'Submit',
        disabled: false,
        hidden: false,
      },
    ],
    rawForms: [
      {
        action: '/login',
        method: 'post',
        name: 'loginForm',
        elementIndices: [1, 2, 3], // search, password, submit
      },
    ],
    filteredCount: 0,
  };
}

export function makeRawElement(
  overrides: Partial<RawInteractiveElement> = {}
): RawInteractiveElement {
  return {
    tagName: 'INPUT',
    role: '',
    accessibleName: 'Field',
    disabled: false,
    hidden: false,
    ...overrides,
  };
}

export function makeRawForm(
  overrides: Partial<RawForm> = {}
): RawForm {
  return {
    elementIndices: [],
    ...overrides,
  };
}
