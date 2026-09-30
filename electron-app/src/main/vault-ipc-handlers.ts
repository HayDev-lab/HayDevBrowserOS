/**
 * Vault IPC handlers — Main process side.
 *
 * Wires CredentialVault to the typed IPC channels:
 *   - vault:save / vault:has / vault:list / vault:generateAndStore / vault:fill / vault:delete
 *
 * Login capture (save-password prompt):
 *   - vault:form-submitted (one-way, from TAB preloads) — a likely login
 *     form submission. Validated, attributed to a tab, held in the main
 *     process by PasswordCaptureService, and offered to the chrome as a
 *     `vault:prompt:update` push. The plaintext password NEVER reaches
 *     the renderer.
 *   - vault:prompt:current (invoke) — initial fetch for the chrome.
 *   - vault:prompt:resolve (invoke) — user answered Save / Not now.
 *
 * SECURITY:
 *   - vault:save accepts plaintext password from the renderer (user input),
 *     encrypts it immediately, and NEVER returns it.
 *   - vault:fill decrypts inside the main process and fills the DOM; NEVER
 *     returns the plaintext to the renderer.
 *   - vault:list returns metadata only (no encryptedPassword field).
 *   - Captured passwords live only inside PasswordCaptureService (main),
 *     are kept out of all push payloads, and are discarded on dismiss,
 *     expiry, or navigation away.
 */
import { ipcMain } from 'electron';
import type {
  VaultSaveInput,
  VaultHasInput,
  VaultGenerateInput,
  VaultFillInput,
} from '@shared/ipc-types';
import type {
  CapturedLoginSubmit,
  PasswordPromptUpdate,
} from '@shared/vault-types';
import type { CredentialVault } from './browser/vault/runtime/credential-vault';
import {
  PasswordCaptureService,
  PROMPT_TTL_MS,
} from './browser/vault/pure/password-capture';

export interface VaultHandlerDeps {
  vault: CredentialVault;
  capture: PasswordCaptureService;
  /** Attributed a captured submission to a tab (null = not one of ours). */
  resolveTabMeta: (wc: Electron.WebContents) => { tabId: string; isIncognito: boolean } | null;
  /** Sender URL cross-check source (BrowserCore). */
  getTabUrl: (tabId: string) => string | null;
  /** Push an update to the chrome renderer. */
  broadcast: (channel: string, payload: PasswordPromptUpdate) => void;
}

export function registerVaultIpcHandlers(deps: VaultHandlerDeps): void {
  const { vault, capture, resolveTabMeta, getTabUrl, broadcast } = deps;

  const pushPrompt = (): void => {
    const prompt = capture.current();
    broadcast('vault:prompt:update', prompt ? { kind: 'set', prompt } : { kind: 'clear' });
  };

  const expireTimer = setInterval(() => {
    if (capture.expired()) {
      capture.expire();
      pushPrompt();
    }
  }, 5_000);
  // The interval must not keep the app alive on quit.
  expireTimer.unref?.();

  // --- Login capture (from TAB preloads; one-way channel) -------------------
  ipcMain.on('vault:form-submitted', (evt, payload: unknown) => {
    const tabMeta = resolveTabMeta(evt.sender);
    if (!tabMeta) return; // Not one of our tab views — ignore.
    if (!payload || typeof payload !== 'object') return;
    const data = payload as Partial<CapturedLoginSubmit>;
    if (typeof data.url !== 'string' || typeof data.password !== 'string') return;
    if (typeof data.username !== 'string') return;
    // Anti-spoof: the page-supplied URL must match the tab's actual URL
    // origin, otherwise ignore (main knows the real URL).
    const tabUrl = getTabUrl(tabMeta.tabId);
    if (!tabUrl || !sameOrigin(tabUrl, data.url)) return;

    const prompt = capture.submit(
      { url: data.url, username: data.username, password: data.password },
      tabMeta
    );
    if (prompt) pushPrompt();
  });

  // --- Save-password prompt (chrome renderer) ------------------------------
  ipcMain.handle('vault:prompt:current', () => {
    return capture.current();
  });

  ipcMain.handle('vault:prompt:resolve', async (_evt, answer: unknown) => {
    const opts = (answer ?? {}) as { promptId?: string; save?: boolean };
    const current = capture.current();
    if (!current || !opts.promptId || opts.promptId !== current.id) {
      // Unknown/expired prompt — still push a clear so the UI can't stick.
      pushPrompt();
      return { success: false, error: 'prompt_not_found' };
    }
    const creds = capture.resolve(opts.save === true);
    let result: { success: boolean; error?: string } = { success: true };
    if (creds) {
      const saved = await vault.save({
        domain: creds.domain,
        username: creds.username,
        password: creds.password,
      });
      result = saved.success
        ? { success: true }
        : { success: false, error: saved.error };
    }
    pushPrompt();
    return result;
  });

  // --- Credential CRUD (existing PROMPT 6 surface) --------------------------
  ipcMain.handle('vault:save', (_evt, input: VaultSaveInput) => {
    return vault.save(input);
  });

  ipcMain.handle('vault:has', (_evt, input: VaultHasInput) => {
    return vault.has(input);
  });

  ipcMain.handle('vault:list', () => {
    return vault.list();
  });

  ipcMain.handle('vault:generateAndStore', (_evt, input: VaultGenerateInput) => {
    return vault.generateAndStore(input);
  });

  ipcMain.handle('vault:fill', (_evt, input: VaultFillInput) => {
    return vault.fill(input);
  });

  ipcMain.handle('vault:delete', (_evt, id: string) => {
    return vault.delete(id);
  });
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

// Re-exported for wiring code that wants to set up its own timer.
export { PROMPT_TTL_MS };
