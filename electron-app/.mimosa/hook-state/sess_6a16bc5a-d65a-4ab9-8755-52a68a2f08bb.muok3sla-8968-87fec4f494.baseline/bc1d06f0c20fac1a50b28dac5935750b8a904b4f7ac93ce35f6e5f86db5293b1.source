/**
 * Tab preload — login form capture for the Credential Vault + the scoped
 * pab://newtab bridge.
 *
 * Runs in EVERY tab WebContentsView (sandboxed, contextIsolation on).
 * Default posture: the page cannot call into this preload — the capture
 * listener lives in the isolated world. ONE exception: pab://newtab
 * documents (our own Matrix New Tab, served by the protocol handler) get a
 * minimal `__pabNewTab` bridge with exactly two operations (attachment
 * picker + Deep Research start). Every method is re-validated against the
 * sender URL in the main process (see newtab-ipc-handlers.ts).
 *
 * SECURITY:
 *   - The bridge is gated on document URL pab://newtab (internal scheme) —
 *     no web origin can ever see it.
 *   - Passwords travel ONLY over the one-way `vault:form-submitted`
 *     channel into the main process and are never persisted anywhere
 *     except through CredentialVault.save (encrypted at rest).
 *   - The attachment channel returns opaque descriptors only — no paths.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { isBridgeDocumentUrl } from '@shared/newtab-bridge';
import type {
  NewTabPickResult,
  NewTabResearchRequest,
  NewTabResearchResult,
} from '@shared/newtab-bridge';

interface CapturedFields {
  username: string;
  password: string;
}

const RESEND_COOLDOWN_MS = 1500;
let lastSentAt = 0;

function inputvalue(el: HTMLInputElement | null | undefined): string {
  return el && typeof el.value === 'string' ? el.value : '';
}

/**
 * Heuristic: the username is the first filled text/email/tel input that
 * appears BEFORE the first password input (falls back to the first empty
 * one). The password is the first non-readonly password input with a value.
 */
function extractLoginFields(form: HTMLFormElement): CapturedFields | null {
  const passwords = Array.from(
    form.querySelectorAll('input[type="password"]')
  ) as HTMLInputElement[];
  const password = passwords.find(
    (el) => !el.disabled && !el.readOnly && el.value.length > 0
  );
  if (!password) return null;

  const candidateSelectors =
    'input[type="text"], input[type="email"], input[type="tel"], input:not([type])';
  const candidates = Array.from(
    form.querySelectorAll(candidateSelectors)
  ) as HTMLInputElement[];
  const visible = candidates.filter(
    (el) => !el.disabled && !el.readOnly && el.type !== 'hidden'
  );
  const beforePassword = visible.filter((el) => {
    // 0 = same position (compare vs document order) — treat as before.
    return el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  const filled = beforePassword.find((el) => el.value.length > 0);
  const fallback = beforePassword[0] ?? visible[0];
  const usernameEl = filled ?? fallback;

  return { username: inputvalue(usernameEl), password: inputvalue(password) };
}

function onSubmit(event: Event): void {
  const form = event.target as HTMLFormElement | null;
  if (!form || typeof form.querySelectorAll !== 'function') return;

  const fields = extractLoginFields(form);
  if (!fields || !fields.password) return;

  const now = Date.now();
  if (now - lastSentAt < RESEND_COOLDOWN_MS) return;
  lastSentAt = now;

  // location is the page's own URL — main cross-checks it against the
  // WebContents' actual URL before prompting.
  ipcRenderer.send('vault:form-submitted', {
    url: String(window.location.href),
    username: fields.username,
    password: fields.password,
  });
}

// Capture phase on the window: catches submits from any document/frame
// this preload runs in, before page handlers can stopPropagation().
window.addEventListener('submit', onSubmit, true);

// Scoped bridge — internal pab:// documents only (Matrix New Tab + HayDev
// Search chat, which hosts the mode switcher). The URL is re-checked in
// main on every call (defense in depth: even a compromised renderer cannot
// reach these channels from a web origin).
if (isBridgeDocumentUrl(window.location.href)) {
  contextBridge.exposeInMainWorld('__pabNewTab', {
    pickAttachment: (kind?: 'file' | 'image'): Promise<NewTabPickResult> =>
      ipcRenderer.invoke('newtab:pickAttachment', kind),
    runResearch: (req: NewTabResearchRequest): Promise<NewTabResearchResult> =>
      ipcRenderer.invoke('newtab:runResearch', req),
  });
}
