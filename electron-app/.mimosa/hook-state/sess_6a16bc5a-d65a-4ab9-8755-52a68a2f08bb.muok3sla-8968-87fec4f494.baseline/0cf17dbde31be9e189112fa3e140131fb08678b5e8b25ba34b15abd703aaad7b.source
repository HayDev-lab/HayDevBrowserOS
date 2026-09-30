/**
 * Vault fill adapter — uses WebContents executeJavaScript to fill login forms.
 *
 * DEFERRED_RUNTIME: imports `electron`. Tests use a fake resolver.
 *
 * SECURITY:
 *   - The fill script is a STATIC template — it does NOT accept caller-supplied JS.
 *   - The username and password values are passed via JSON.stringify (escaped
 *     as JSON string literals, not interpolated as code).
 *   - The script finds the first visible password-type input and the nearest
 *     text/email input before it, then sets their values.
 *   - After filling, the plaintext values are discarded (they go out of scope
 *     when the function returns).
 */
import type { WebContents } from 'electron';
import type { EncryptionAdapter } from '@shared/vault-types';
import { ActionError } from '../../actions/pure/action-router';

export interface VaultFillAdapterDeps {
  resolveWebContents: (tabId: string) => WebContents | null;
  encryption: EncryptionAdapter;
}

export interface FillResult {
  usernameFilled: boolean;
  passwordFilled: boolean;
}

export class VaultFillAdapter {
  constructor(private deps: VaultFillAdapterDeps) {}

  /**
   * Fill the login form on the tab's page with the given (encrypted) credential.
   *
   * The encrypted password is decrypted INSIDE this method (main-process only).
   * The plaintext is passed to the fill script as a JSON string literal, then
   * discarded. It is NEVER stored, logged, or returned.
   */
  async fill(
    tabId: string,
    username: string,
    encryptedPassword: string
  ): Promise<FillResult> {
    const wc = this.deps.resolveWebContents(tabId);
    if (!wc || wc.isDestroyed()) {
      throw new ActionError('tab_not_found', `tab_id:${tabId}`);
    }

    // Decrypt the password — main-process only.
    const plaintextPassword = this.deps.encryption.decryptString(encryptedPassword);

    try {
      const script = buildFillScript(username, plaintextPassword);
      const result = (await wc.executeJavaScript(script, true)) as FillResult;
      return result;
    } catch (err) {
      throw new ActionError(
        'fill_failed',
        `tab:${tabId},${safeErr(err)}`
      );
    } finally {
      // The plaintextPassword variable goes out of scope here. We cannot
      // forcibly zero it (JS strings are immutable), but we ensure no
      // reference to it persists after this function returns.
      void plaintextPassword;
    }
  }
}

/**
 * Build the fill script. STATIC template — the only caller-supplied data
 * that reaches the page is the username and password, both escaped via
 * JSON.stringify (JSON string literals, not code).
 */
function buildFillScript(username: string, password: string): string {
  const userJson = JSON.stringify(username);
  const passJson = JSON.stringify(password);
  return `(function () {
  var USERNAME = ${userJson};
  var PASSWORD = ${passJson};

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Find the first visible password input.
  var pwInputs = Array.prototype.slice.call(
    document.querySelectorAll('input[type="password"]')
  );
  var pwInput = pwInputs.find(isVisible);

  if (!pwInput) {
    return { usernameFilled: false, passwordFilled: false };
  }

  // Find the nearest visible text/email input BEFORE the password input.
  var allInputs = Array.prototype.slice.call(
    document.querySelectorAll('input[type="text"], input[type="email"], input:not([type])')
  );
  var pwIndex = allInputs.indexOf(pwInput);
  var userInput = null;
  for (var i = pwIndex - 1; i >= 0; i--) {
    if (isVisible(allInputs[i])) {
      userInput = allInputs[i];
      break;
    }
  }

  var usernameFilled = false;
  var passwordFilled = false;

  if (userInput) {
    try {
      userInput.focus();
      userInput.value = USERNAME;
      userInput.dispatchEvent(new Event('input', { bubbles: true }));
      userInput.dispatchEvent(new Event('change', { bubbles: true }));
      usernameFilled = true;
    } catch (e) {
      // ignore — report as not filled
    }
  }

  try {
    pwInput.focus();
    pwInput.value = PASSWORD;
    pwInput.dispatchEvent(new Event('input', { bubbles: true }));
    pwInput.dispatchEvent(new Event('change', { bubbles: true }));
    passwordFilled = true;
  } catch (e) {
    // ignore — report as not filled
  }

  return { usernameFilled: usernameFilled, passwordFilled: passwordFilled };
})();`;
}

function safeErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/\s+/g, ' ').slice(0, 200);
  }
  return String(err).slice(0, 200);
}
