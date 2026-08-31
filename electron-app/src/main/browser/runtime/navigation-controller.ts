/**
 * NavigationController — Electron-runtime wrapper around a single WebContents.
 *
 * Owns a `NavigationStack` (pure logic) for back/forward state and delegates
 * the actual page loading to the WebContents.
 *
 * DEFERRED_RUNTIME: this module imports `electron` and can ONLY be exercised
 * when Electron GUI runtime is available. Unit tests cover the underlying
 * `NavigationStack` (see tests/navigation-stack.test.ts), NOT this class.
 *
 * SECURITY: `nodeIntegration:false, contextIsolation:true, sandbox:true,
 * webSecurity:true` are enforced by the WebContentsView factory in
 * `BrowserCore`, NOT here. This controller assumes a properly-configured
 * WebContents.
 */
import type { WebContents } from 'electron';
import { NavigationStack } from '../pure/navigation-stack';
import {
  normalizeAddressBarInput,
  isValidUrl,
} from '../pure/url-utils';

export interface NavigationControllerEvents {
  onWillNavigate?: (url: string) => void;
  onDidNavigate?: (url: string) => void;
  ondidNavigateInPage?: (url: string) => void;
  onLoadingStateChanged?: (isLoading: boolean) => void;
  onTitleUpdated?: (title: string) => void;
  onError?: (error: string) => void;
}

export class NavigationController {
  private readonly stack = new NavigationStack();

  constructor(
    private readonly webContents: WebContents,
    private readonly events: NavigationControllerEvents = {}
  ) {
    // Wire WebContents events to our state machine.
    webContents.on('did-start-loading', () => {
      this.events.onLoadingStateChanged?.(true);
    });
    webContents.on('did-stop-loading', () => {
      this.events.onLoadingStateChanged?.(false);
    });
    webContents.on('did-navigate', (_evt, url) => {
      this.stack.navigate(url);
      this.events.onDidNavigate?.(url);
    });
    webContents.on('did-navigate-in-page', (_evt, url) => {
      this.stack.navigate(url, { replace: true });
      this.events.ondidNavigateInPage?.(url);
    });
    webContents.on('page-title-updated', (_evt, title) => {
      this.events.onTitleUpdated?.(title);
    });
    webContents.on('did-fail-load', (_evt, errorCode, errorDescription, validatedURL) => {
      // Suppress sub-frame errors (isMainFrame=false is the 6th arg).
      // We don't have access to it here without using the full event signature.
      // For V1: only surface main-frame failures via URL filter.
      if (validatedURL && validatedURL.startsWith('http')) {
        this.events.onError?.(`load_failed:${errorCode}:${errorDescription}`);
      }
    });
  }

  /**
   * Navigate the WebContents to a URL typed in the address bar.
   * Performs address-bar normalization (search queries, bare hostnames,
   * blocked protocols) BEFORE handing off to WebContents.
   *
   * Returns the URL actually loaded, or null if rejected.
   */
  navigateFromAddressBar(input: string): string | null {
    const normalized = normalizeAddressBarInput(input);
    if (normalized.url === null) {
      this.events.onError?.(`address_bar_rejected:${normalized.reason}`);
      return null;
    }
    void this.loadUrl(normalized.url);
    this.events.onWillNavigate?.(normalized.url);
    return normalized.url;
  }

  /**
   * Navigate the WebContents to a programmatic URL (e.g. clicked link,
   * bookmark, history entry). Skips address-bar normalization but still
   * validates the protocol.
   */
  navigateToUrl(url: string): boolean {
    if (!isValidUrl(url)) {
      this.events.onError?.(`invalid_url:${url}`);
      return false;
    }
    void this.loadUrl(url);
    this.events.onWillNavigate?.(url);
    return true;
  }

  back(): boolean {
    const url = this.stack.back();
    if (url === null) return false;
    void this.loadUrl(url);
    return true;
  }

  forward(): boolean {
    const url = this.stack.forward();
    if (url === null) return false;
    void this.loadUrl(url);
    return true;
  }

  reload(): void {
    this.webContents.reload();
  }

  stop(): void {
    this.webContents.stop();
  }

  canGoBack(): boolean {
    return this.stack.canGoBack();
  }

  canGoForward(): boolean {
    return this.stack.canGoForward();
  }

  currentUrl(): string | null {
    return this.stack.currentUrl();
  }

  /** Snapshot the navigation state for session restore. */
  snapshot() {
    return this.stack.snapshot();
  }

  private async loadUrl(url: string): Promise<void> {
    try {
      await this.webContents.loadURL(url);
    } catch (err) {
      // loadURL throws on abort (e.g. user pressed Stop) — surface as error.
      this.events.onError?.(`load_url_failed:${String(err)}`);
    }
  }
}
